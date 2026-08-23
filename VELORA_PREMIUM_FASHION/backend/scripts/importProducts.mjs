import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, "..", "data");
const outputFile = path.join(outputDir, "products.json");
const apiRoot = "https://api.github.com/repos/codewithzosh/ecommerce-products-data/contents";
const headers = {
  "User-Agent": "velora-store-product-importer",
  Accept: "application/vnd.github+json"
};

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed ${url}: ${response.status}`);
  }
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed ${url}: ${response.status}`);
  }
  return response.text();
}

async function listFiles(url = `${apiRoot}?ref=master`) {
  const entries = await getJson(url);
  const files = [];

  for (const entry of entries) {
    if (entry.type === "dir") {
      files.push(...(await listFiles(`${apiRoot}/${encodeURIComponent(entry.path)}?ref=master`)));
    } else if (/\.(json|js)$/i.test(entry.name) && !/navigation|package/i.test(entry.name)) {
      files.push(entry);
    }
  }

  return files;
}

function parseJsArray(source, filePath) {
  const match = source.match(/export\s+const\s+\w+\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) {
    throw new Error(`Could not find exported array in ${filePath}`);
  }

  return vm.runInNewContext(`(${match[1]})`, Object.create(null), {
    timeout: 1000,
    displayErrors: false
  });
}

function parsePrice(value) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDiscount(product) {
  if (typeof product.discountPersent === "number") return product.discountPersent;
  const parsed = Number(String(product.disscount || "").match(/\d+/)?.[0] || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function categoryFromPath(filePath, product) {
  const third = product.thirdLavelCategory || "";
  if (third) return titleCase(third);

  const folder = filePath.split("/")[0] || "";
  const file = path.basename(filePath, path.extname(filePath));
  return titleCase(folder === file ? folder : file);
}

function genderFromProduct(product, filePath) {
  const label = `${product.topLavelCategory || ""} ${filePath}`.toLowerCase();
  if (label.includes("women") || label.includes("saree") || label.includes("kurta") || label.includes("gouns")) {
    return "Women";
  }
  if (label.includes("men")) return "Men";
  return "Unisex";
}

function normalize(product, filePath, index) {
  const sellingPrice = parsePrice(product.discountedPrice || product.selling_price || product.price);
  const mrp = parsePrice(product.price) || sellingPrice;
  const discountPercent = parseDiscount(product);
  const category = categoryFromPath(filePath, product);
  const gender = genderFromProduct(product, filePath);
  const title = product.title || product.name || `${product.brand || "Velora"} ${category}`;

  return {
    id: `${filePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${index + 1}`,
    title,
    brand: product.brand || "Velora Atelier",
    image: product.imageUrl || product.image || "",
    color: product.color || "Signature",
    sellingPrice,
    mrp,
    discountPercent,
    category,
    gender,
    section: product.secondLavelCategory || "Collection",
    description:
      product.description ||
      `A curated ${category.toLowerCase()} selection for the Velora-inspired collection.`,
    rating: Number((4.1 + ((index % 8) * 0.1)).toFixed(1)),
    source: filePath
  };
}

export async function importProducts() {
  const files = await listFiles();
  const allProducts = [];

  for (const file of files) {
    const source = await getText(file.download_url);
    const parsed = file.name.endsWith(".json") ? JSON.parse(source) : parseJsArray(source, file.path);
    if (!Array.isArray(parsed)) {
      console.warn(`Skipping ${file.path}; expected an array.`);
      continue;
    }

    parsed.forEach((product, index) => allProducts.push(normalize(product, file.path, index)));
  }

  const uniqueProducts = [...new Map(allProducts.map((product) => [product.id, product])).values()];
  return uniqueProducts;
}

async function main() {
  const products = await importProducts();
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(products, null, 2)}\n`, "utf8");
  console.log(`Imported ${products.length} products to ${outputFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
