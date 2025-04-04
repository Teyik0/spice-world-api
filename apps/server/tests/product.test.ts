import { treaty } from '@elysiajs/eden';
import type {
  Category,
  Image,
  Product,
  ProductVariant,
  Tag
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { productsRouter } from '../src/routes/product.router';
import { createDummyProducts } from './utils/dummy-products';
import {
  createDummyAttributes,
  type AttributeWithValues
} from './utils/dummy-attributes';
import { createDummyTags } from './utils/dummy-tags';
import { resetDb } from './utils/reset-db';
import { utapi } from '../src/libs/images';

const api = treaty(productsRouter);

describe('Product routes test', () => {
  let testCategories: Category[];
  let testProducts: (Product & {
    variants: ProductVariant[];
    images: Image[];
  })[];
  let testTags: Tag[];
  let testAttributes: AttributeWithValues[];

  // Setup - create test data
  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production')
      throw new Error("You can't run tests in production");
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL should be set');

    await resetDb();
    const { categories, products } = await createDummyProducts();
    testAttributes = await createDummyAttributes();
    testTags = await createDummyTags();
    testCategories = categories;
    testProducts = products;
  });

  afterAll(async () => {
    await resetDb();
  });

  describe('GET /products', () => {
    it('should return a list of products sorted by name', async () => {
      const { data, status } = await api.products.index.get({
        query: { sortBy: 'name', sortDir: 'asc' }
      });
      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data?.length).toBe(testProducts.length);

      // Verify our test products are in the response
      const testProductNames = testProducts
        .map((p) => p.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      const returnedProductNames = data?.map((p) => p.name) || [];

      testProductNames.forEach((name) => {
        expect(returnedProductNames).toContain(name);
      });

      expect(testProductNames).toEqual(returnedProductNames);
    });

    it('should return a list of products sorted by price', async () => {
      const { data, status } = await api.products.index.get({
        query: { sortBy: 'price', sortDir: 'asc' }
      });

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data?.length).toBe(testProducts.length);

      // Verify the products are sorted by the minimum price of their variants
      const sortedProducts = [...testProducts].sort((a, b) => {
        const aMinPrice = Math.min(...a.variants.map((v) => v.price));
        const bMinPrice = Math.min(...b.variants.map((v) => v.price));
        return aMinPrice - bMinPrice;
      });

      const returnedProductNames = data?.map((p) => p.name) || [];
      const sortedProductNames = sortedProducts.map((p) => p.name);

      // Verify the products are sorted by price
      expect(returnedProductNames).toEqual(sortedProductNames);
    });

    it('should return a list of products filtered by category', async () => {
      const category = testCategories[0];
      const { data, status } = await api.products.index.get({
        query: { categories: [category.name] }
      });

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(Array.isArray(data)).toBe(true);

      // All returned products should belong to the specified category
      data?.forEach((product) => {
        expect(product.categoryId).toBe(category.id);
      });
    });

    it('should return a list of products filtered by status', async () => {
      const { data, status } = await api.products.index.get({
        query: { status: 'PUBLISHED' }
      });

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(Array.isArray(data)).toBe(true);

      // All returned products should have the status PUBLISHED
      data?.forEach((product) => {
        expect(product.status).toBe('PUBLISHED');
      });
    });
  });

  describe('GET /products/count', () => {
    it('should return the total count of products', async () => {
      const { data, status } = await api.products.count.get({
        query: {}
      });

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(typeof data).toBe('number');

      // Verify the count matches the number of test products
      expect(data).toBe(testProducts.length);
    });

    it('should return the count of products filtered by status', async () => {
      const { data, status } = await api.products.count.get({
        query: { status: 'PUBLISHED' }
      });

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(typeof data).toBe('number');

      // Verify the count matches the number of published test products
      expect(data).toBe(
        testProducts.filter((p) => p.status === 'PUBLISHED').length
      );
    });
  });

  describe('POST /products', () => {
    it('should create a new product successfully', async () => {
      const filePath1 = `${import.meta.dir}/public/cumin.webp`;
      const filePath2 = `${import.meta.dir}/public/curcuma.jpg`;

      const category = testCategories[0];
      const newProduct = {
        name: 'New spice',
        description: 'A new spice for testing',
        categoryId: category.id,
        status: 'PUBLISHED' as 'PUBLISHED',
        tags: [testTags[0].id],
        variants: [
          {
            price: 10.99,
            sku: 'NEW-SPICE-001',
            stock: 100,
            attributeValueIds: testAttributes[0].values.map((value) => value.id)
          }
        ],
        images: [Bun.file(filePath1), Bun.file(filePath2)]
      };

      const { data, status } = await api.products.index.post({
        name: newProduct.name,
        description: newProduct.description,
        categoryId: newProduct.categoryId,
        status: newProduct.status,
        tags: JSON.stringify(newProduct.tags) as any,
        variants: JSON.stringify(newProduct.variants) as any,
        images: [Bun.file(filePath1), Bun.file(filePath2)]
      });

      expect(status).toBe(201);
      expect(data).not.toBeNull();
      const productData = data as NonNullable<typeof data>;
      expect(productData.name).toBe(newProduct.name);
      expect(productData.description).toBe(newProduct.description);
      expect(productData.categoryId).toBe(newProduct.categoryId);
      expect(productData.status).toBe(newProduct.status as 'DRAFT');
      expect(productData.variants.length).toBe(newProduct.variants.length);
      expect(productData.images.length).toBe(newProduct.images.length);
      for (const image of productData.images) {
        const { success } = await utapi.deleteFiles(image.key);
        expect(success).toBe(true);
      }
    });

    it('should return an error if the product name already exists', async () => {
      const filePath1 = `${import.meta.dir}/public/cumin.webp`;
      const filePath2 = `${import.meta.dir}/public/curcuma.jpg`;

      const existingProduct = testProducts[0];
      const newProduct = {
        name: existingProduct.name,
        description: 'A duplicate product name',
        categoryId: existingProduct.id,
        status: 'PUBLISHED' as 'PUBLISHED',
        tags: [testTags[0].id, testTags[1].id],
        variants: [
          {
            price: 10.99,
            sku: 'DUPLICATE-NAME-001',
            stock: 100,
            currency: 'EUR',
            attributeValueIds: testAttributes.map((value) => value.id)
          }
        ],
        images: [Bun.file(filePath1), Bun.file(filePath2)]
      };

      const { error, status } = await api.products.index.post({
        name: newProduct.name,
        description: newProduct.description,
        categoryId: newProduct.categoryId,
        status: newProduct.status,
        tags: JSON.stringify(newProduct.tags) as any,
        variants: JSON.stringify(newProduct.variants) as any,
        images: newProduct.images
      });

      expect(status).toBe(409);
      expect(error).not.toBeNull();
    });
  });

  describe('GET /products/:id', () => {
    it('should return a product by id', async () => {
      const { data, status } = await api
        .products({ id: testProducts[0].id })
        .get();

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(data?.name).toBe(testProducts[0].name);
      expect(data?.categoryId).toBe(testProducts[0].categoryId);
    });
  });

  describe('PATCH /products/:id', () => {
    const filePath1 = `${import.meta.dir}/public/cumin.webp`;
    const filePath2 = `${import.meta.dir}/public/curcuma.jpg`;

    it('should update the product successfully', async () => {
      const updatedProductData = {
        name: 'Updated Spice',
        description: 'An updated description',
        status: 'DRAFT' as 'DRAFT',
        tags: [testTags[1].id, testTags[0].id],
        variants: [
          {
            price: 12.99,
            sku: 'UPDATED-SPICE-002',
            stock: 50,
            attributeValueIds: testAttributes[0].values.map((value) => value.id)
          }
        ],
        images: [Bun.file(filePath1), Bun.file(filePath2)]
      };

      const { data, status } = await api
        .products({ id: testProducts[0].id })
        .patch({
          name: updatedProductData.name,
          description: updatedProductData.description,
          status: updatedProductData.status,
          tags: JSON.stringify(updatedProductData.tags) as any,
          variants: JSON.stringify(updatedProductData.variants) as any,
          images: updatedProductData.images as File[]
        });

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      const productData = data as NonNullable<typeof data>;
      expect(productData.name).toBe(updatedProductData.name);
      expect(productData.description).toBe(updatedProductData.description);
      expect(productData.status).toBe(updatedProductData.status);
      expect(productData.variants.length).toBe(
        updatedProductData.variants.length
      );
      expect(productData.variants[0].price).toBe(
        updatedProductData.variants[0].price
      );
      expect(productData.variants[0].stock).toBe(
        updatedProductData.variants[0].stock
      );
      expect(productData.images.length).toBe(
        testProducts[0].images.length + updatedProductData.images.length
      );

      for (const image of productData.images) {
        const { success } = await utapi.deleteFiles(image.key);
        expect(success).toBe(true);
      }
    });

    it('should return an error if the product ID does not exist', async () => {
      const updatedProductData = {
        name: 'Non-existent Product',
        description: 'This product does not exist',
        status: 'DRAFT' as 'DRAFT'
      };

      const { status, error } = await api
        .products({ id: '00000000-0000-0000-0000-000000000023' })
        .patch(updatedProductData);

      expect(status).toBe(404);
      expect(error).not.toBeNull();
    });

    it('should return an error update name conflict with an existing product', async () => {
      const updatedProductData = {
        name: testProducts[1].name,
        description: 'This product does not exist',
        status: 'DRAFT' as 'DRAFT'
      };

      const { status, error } = await api
        .products({ id: testProducts[0].id })
        .patch(updatedProductData);

      expect(status).toBe(409);
      expect(error).not.toBeNull();
    });
  });

  describe('DELETE /products/:id', () => {
    it('should delete a product successfully', async () => {
      const productToDelete = testProducts[0];

      const { data, status } = await api
        .products({ id: productToDelete.id })
        .delete();

      expect(status).toBe(200);
      expect(data).not.toBeNull();
      expect(data?.id).toBe(productToDelete.id);

      // Verify the product is deleted
      const { data: deletedProduct, status: getStatus } = await api
        .products({ id: productToDelete.id })
        .get();

      expect(getStatus).toBe(404);
      expect(deletedProduct).toBeNull();
    });

    it('should return an error if the product ID does not exist', async () => {
      const nonExistentProductId = '00000000-0000-0000-0000-000000000023';

      const { status, error } = await api
        .products({ id: nonExistentProductId })
        .delete();

      expect(status).toBe(404);
      expect(error).not.toBeNull();
    });
  });
});
