import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { getVariantAvailability, QueryContext } from "@medusajs/framework/utils"
import { CalculatedPriceSet } from "@medusajs/framework/types"

export type FeedItem = {
  id: string
  title: string
  description: string
  link: string
  image_link?: string
  additional_image_link?: string
  availability: string
  price: string
  sale_price?: string
  condition?: string
  brand?: string
}

type StepInput = {
  currency_code: string
  country_code: string
}

const formatPrice = (price: number, currency_code: string) => {
  return new Intl.NumberFormat("en-US", {
    currency: currency_code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price)
}

export const getProductFeedItemsStep = createStep(
  "get-product-feed-items", 
  async (input: StepInput, { container }) => {
  const feedItems: FeedItem[] = []
  const query = container.resolve("query")
  const configModule = container.resolve("configModule")
  const storefrontUrl = configModule.admin.storefrontUrl || process.env.STOREFRONT_URL

  const limit = 100
  let offset = 0
  let count = 0

  do {
    const {
      data: products,
      metadata
    } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "description",
        "handle",
        "thumbnail",
        "images.*",
        "status",
        "variants.*",
        "variants.calculated_price.*",
        "sales_channels.*",
        "sales_channels.stock_locations.*"
      ],
      filters: {
        status: "published",
      },
      context: {
        variants: {
          calculated_price: QueryContext({
            currency_code: input.currency_code,
          }),
        }
      },
    })
    
    count = metadata?.count ?? 0
    offset += limit

    for (const product of products) {
      if (!product.variants.length) continue
      const salesChannel = product.sales_channels?.find((channel) => {
        return channel?.stock_locations?.some((location) => {
          return location?.address?.country_code === input.country_code
        })
      })

      const availability = salesChannel?.id ? await getVariantAvailability(query, {
        variant_ids: product.variants.map((variant) => variant.id),
        sales_channel_id: salesChannel?.id,
      }) : undefined

      for (const variant of product.variants) {
        // @ts-ignore
        const calculatedPrice = variant.calculated_price as CalculatedPriceSet
        const hasOriginalPrice = calculatedPrice?.original_amount
        const originalPrice = hasOriginalPrice ? calculatedPrice.original_amount : calculatedPrice.calculated_amount
        const salePrice = hasOriginalPrice ? calculatedPrice.calculated_amount : undefined
        const stockStatus = !variant.manage_inventory ? "in stock" : 
          !availability?.[variant.id]?.availability ? "out of stock" : "in stock"

        feedItems.push({
          id: variant.id,
          title: product.title,
          description: product.description ?? "",
          link: `${storefrontUrl}/${input.country_code}/${product.handle}`,
          image_link: product.thumbnail ?? "",
          additional_image_link: product.images?.map((image) => image.url)?.join(","),
          availability: stockStatus,
          price: formatPrice(originalPrice as number, input.currency_code),
          sale_price: salePrice ? formatPrice(salePrice as number, input.currency_code) : undefined,
          condition: "new", // TODO add condition if supported
          brand: "" // TODO add brands if supported
        })
      }
    }
  } while (count > offset)

  return new StepResponse({ items: feedItems })
})