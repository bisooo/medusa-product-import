const Medusa = require("@medusajs/medusa-js").default
const fs = require('fs').promises
const { parse } = require('csv-parse/sync')
require('dotenv').config()

const medusa = new Medusa({ 
  baseUrl: process.env.MEDUSA_BACKEND_URL, 
  maxRetries: 3,
})


// The categories and their heirarchy will be created from the medusa admin dashboard
// Each product will have some heirarchy of categories assigned to it (E.g. Film > 35mm > Point&Shoot)

async function getCategoryMap() {
  const { product_categories } = await medusa.admin.productCategories.list({ limit: 1000 })
  const categoryMap = new Map()

  function buildCategoryPath(category) {
    if (!category.parent_category) {
      return category.name
    }
    return `${buildCategoryPath(category.parent_category)} > ${category.name}`
  }

  for (const category of product_categories) {
    const path = buildCategoryPath(category)
    categoryMap.set(path.toLowerCase(), category.id)
  }

  return categoryMap
}

async function importProducts() {
  try {
    await medusa.admin.auth.getToken({
      email: "admin@medusa-test.com",
      password: "admin",
    })

    const categoryMap = await getCategoryMap()
    const fileContent = await fs.readFile('products.csv', 'utf-8')
    const products = parse(fileContent, { columns: true, trim: true })

    for (const product of products) {
      try {
        const handle = product.name.toLowerCase().replace(/ /g, '-')
        
        // Check if product already exists
        const { products: existingProducts } = await medusa.admin.products.list({ handle: handle })
        
        if (existingProducts.length > 0) {
          console.log(`Product ${product.name} already exists. Skipping.`)
          continue
        }

        // Find the category ID
        const categoryPath = product.category.toLowerCase()
        const categoryId = categoryMap.get(categoryPath)

        if (!categoryId) {
          console.log(`Category ${product.category} not found. Skipping product ${product.name}.`)
          continue
        }

        // Create product
        const { product: createdProduct } = await medusa.admin.products.create({
          title: product.name,
          handle: handle,
          description: product.description,
          categories: [{ id: categoryId }],
          images: [product.image, ...(product.images || '').split(',').filter(img => img.trim())],
          thumbnail: product.mainImage || product.image,
          variants: [
            {
              title: product.name,
              prices: [{ amount: parseFloat(product.price) * 100, currency_code: "usd" }],
              inventory_quantity: 1,
              manage_inventory: true
            }
          ],
          status: "published",
          metadata: {
            brand: product.brand,
            details: {
              "short-description": product["short-description"],
              "short-specs": product["short-specs"],
              condition: product.condition,
              testing: product.testing,
              delivery: product.delivery
            },
            specs: {
              Lens: product.Lens,
              "Focal Length": product["Focal Length"],
              "Shutter Speed": product["Shutter Speed"],
              "ISO Range": product["ISO Range"],
              storage: product.storage,
              battery: product.battery,
              Weight: product.Weight,
              Dimensions: product.Dimensions
            }
          }
        })

        console.log(`Created product: ${createdProduct.title} in category: ${product.category}`)
      } catch (error) {
        console.error(`Error processing product ${product.name}:`, error.response?.data || error.message)
      }
    }
  } catch (error) {
    console.error("Import failed:", error.message)
  }
}

importProducts().catch(console.error)