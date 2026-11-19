import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { computeReviewSummary, hashPassword, slugify } from './logic.ts';
import type {
  Category,
  Collection,
  CustomerProfile,
  HomepageConfig,
  Offer,
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductReview,
  ReviewSummary,
  StoreSettings,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'orva7.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    revoked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    parent_id TEXT,
    image TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    sale_price REAL,
    show_price INTEGER NOT NULL DEFAULT 1,
    images_json TEXT NOT NULL DEFAULT '[]',
    sizes_json TEXT NOT NULL DEFAULT '[]',
    colors_json TEXT NOT NULL DEFAULT '[]',
    stock INTEGER NOT NULL DEFAULT 0,
    category_id TEXT,
    collection_ids_json TEXT NOT NULL DEFAULT '[]',
    is_published INTEGER NOT NULL DEFAULT 1,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_best_seller INTEGER NOT NULL DEFAULT 0,
    is_new_arrival INTEGER NOT NULL DEFAULT 0,
    show_on_homepage INTEGER NOT NULL DEFAULT 1,
    sales_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_image TEXT NOT NULL DEFAULT '',
    product_ids_json TEXT NOT NULL DEFAULT '[]',
    is_published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    banner_text TEXT NOT NULL DEFAULT '',
    discount_percent REAL NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'all',
    target_ids_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    customer_id TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT NOT NULL DEFAULT '',
    customer_notes TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL DEFAULT '[]',
    subtotal REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    currency_symbol TEXT NOT NULL DEFAULT 'ج.م',
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT NOT NULL DEFAULT 'whatsapp_cod',
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_reference TEXT NOT NULL DEFAULT '',
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wishlist_items (
    customer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (customer_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS product_reviews (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    order_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(product_id, customer_id)
  );

  CREATE TABLE IF NOT EXISTS kv_config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function ensureOrderPaymentColumns(): void {
  const cols = db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const additions: Array<[string, string]> = [
    ['customer_id', 'TEXT'],
    ['payment_method', "TEXT NOT NULL DEFAULT 'whatsapp_cod'"],
    ['payment_status', "TEXT NOT NULL DEFAULT 'unpaid'"],
    ['payment_reference', "TEXT NOT NULL DEFAULT ''"],
    ['paid_at', 'TEXT'],
  ];
  for (const [col, def] of additions) {
    if (!names.has(col)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def};`);
    }
  }
}

ensureOrderPaymentColumns();

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function seedInitialData(): void {
  const now = new Date().toISOString();

  const adminCount = db.prepare('SELECT COUNT(*) as cnt FROM admin_users').get() as { cnt: number };
  if ((adminCount?.cnt || 0) === 0) {
    const username = (process.env.ORVA_ADMIN_USER || 'MohamedGalal7').trim();
    const initialPassword = (process.env.ORVA_ADMIN_PASSWORD || 'OzRxVcA7').trim();
    db.prepare(
      'INSERT INTO admin_users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).run('admin-1', username, hashPassword(initialPassword), now);
  }

  const catCount = db.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number };
  if ((catCount?.cnt || 0) === 0) {
    const categories: Category[] = [
      {
        id: 'cat-outerwear',
        name: 'المعاطف والبليزر',
        slug: 'outerwear-blazers',
        parentId: null,
        image: '/src/assets/images/product_navy_blazer_1795105956851.jpg',
        sortOrder: 1,
        isVisible: true,
        createdAt: now,
      },
      {
        id: 'cat-shirts',
        name: 'القمصان الحريرية',
        slug: 'silk-shirts',
        parentId: null,
        image: '/src/assets/images/product_silver_silk_shirt_1795105956999.jpg',
        sortOrder: 2,
        isVisible: true,
        createdAt: now,
      },
      {
        id: 'cat-trousers',
        name: 'البناطيل المصممة',
        slug: 'tailored-trousers',
        parentId: null,
        image: '/src/assets/images/product_obsidian_trousers_1795105956411.jpg',
        sortOrder: 3,
        isVisible: true,
        createdAt: now,
      },
      {
        id: 'cat-trench',
        name: 'معاطف الترنش',
        slug: 'trench-coats',
        parentId: 'cat-outerwear',
        image: '/src/assets/images/product_gold_trench_1795105956662.jpg',
        sortOrder: 4,
        isVisible: true,
        createdAt: now,
      },
    ];

    const stmt = db.prepare(
      'INSERT INTO categories (id, name, slug, parent_id, image, sort_order, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of categories) {
      stmt.run(c.id, c.name, c.slug, c.parentId, c.image, c.sortOrder, c.isVisible ? 1 : 0, c.createdAt);
    }
  }

  const colCount = db.prepare('SELECT COUNT(*) as cnt FROM collections').get() as { cnt: number };
  if ((colCount?.cnt || 0) === 0) {
    const collections: Collection[] = [
      {
        id: 'col-atelier-midnight',
        name: 'كبسولة أتيليه منتصف الليل',
        slug: 'atelier-midnight',
        description: 'قطع مفصلة بدقة معمارية تجمع بين الكحلي العميق والفضة المصقولة.',
        coverImage: '/src/assets/images/collection_noir_capsule_1795105957687.jpg',
        productIds: ['prod-navy-blazer', 'prod-obsidian-trousers', 'prod-silver-shirt'],
        isPublished: true,
        sortOrder: 1,
        createdAt: now,
      },
      {
        id: 'col-lumiere-gold',
        name: 'مجموعة لوميير الذهبية',
        slug: 'lumiere-gold',
        description: 'إطلالات نهارية ومسائية بدرجات الرملي الذهبي والحرير البلاتيني.',
        coverImage: '/src/assets/images/hero_orva_atelier_1795105957240.jpg',
        productIds: ['prod-gold-trench', 'prod-silver-shirt'],
        isPublished: true,
        sortOrder: 2,
        createdAt: now,
      },
    ];

    const stmt = db.prepare(
      'INSERT INTO collections (id, name, slug, description, cover_image, product_ids_json, is_published, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const col of collections) {
      stmt.run(
        col.id,
        col.name,
        col.slug,
        col.description,
        col.coverImage,
        JSON.stringify(col.productIds),
        col.isPublished ? 1 : 0,
        col.sortOrder,
        col.createdAt
      );
    }
  }

  const prodCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number };
  if ((prodCount?.cnt || 0) === 0) {
    const products: Product[] = [
      {
        id: 'prod-navy-blazer',
        slug: 'orva-midnight-cashmere-blazer',
        name: 'بليزر أتيليه كشمير كحلي',
        description:
          'بليزر مزدوج الصدر من صوف الكشمير الإيطالي الفاخر، مزود بأزرار فضية مصقولة وقصة هندسية تبرز توازن الكتفين بلمسة دار ORVA 7.',
        price: 12800,
        salePrice: null,
        showPrice: true,
        images: [
          '/src/assets/images/product_navy_blazer_1795105956851.jpg',
          '/src/assets/images/hero_orva_atelier_1795105957240.jpg',
        ],
        sizes: ['S', 'M', 'L', 'XL'],
        colors: [
          { name: 'كحلي ليلي', hex: '#0A1628' },
          { name: 'أسود فحمي', hex: '#181C24' },
        ],
        stock: 14,
        categoryId: 'cat-outerwear',
        collectionIds: ['col-atelier-midnight'],
        isPublished: true,
        isFeatured: true,
        isBestSeller: true,
        isNewArrival: true,
        showOnHomepage: true,
        salesCount: 64,
        createdAt: '2026-11-10T09:00:00.000Z',
        updatedAt: now,
      },
      {
        id: 'prod-silver-shirt',
        slug: 'orva-platinum-mulberry-silk-shirt',
        name: 'قميص حرير التوت الفضي',
        description:
          'قميص منسوج من حرير التوت الخالص بدرجة بلاتينية عاكسة للضوء، مع ياقة مهيكلة وبطانة أزرار مخفية لانسيابية فائقة.',
        price: 5400,
        salePrice: 4650,
        showPrice: true,
        images: ['/src/assets/images/product_silver_silk_shirt_1795105956999.jpg'],
        sizes: ['XS', 'S', 'M', 'L'],
        colors: [
          { name: 'فضي بلاتيني', hex: '#C4CCD6' },
          { name: 'أبيض لؤلؤي', hex: '#F3F4F6' },
        ],
        stock: 22,
        categoryId: 'cat-shirts',
        collectionIds: ['col-atelier-midnight', 'col-lumiere-gold'],
        isPublished: true,
        isFeatured: true,
        isBestSeller: true,
        isNewArrival: true,
        showOnHomepage: true,
        salesCount: 91,
        createdAt: '2026-11-12T09:00:00.000Z',
        updatedAt: now,
      },
      {
        id: 'prod-gold-trench',
        slug: 'orva-champagne-gabardine-trench',
        name: 'معطف ترنش غاباردين شامبين',
        description:
          'معطف ترنش طويل مقاوم للماء من قطن الغاباردين المزدوج، يتميز بإبزيم معدني بلون الذهب المطفي وتفصيل كتف متباين.',
        price: 15900,
        salePrice: null,
        showPrice: true,
        images: ['/src/assets/images/product_gold_trench_1795105956662.jpg'],
        sizes: ['S', 'M', 'L'],
        colors: [
          { name: 'ذهبي رملي', hex: '#C6A55C' },
          { name: 'كحلي ليلي', hex: '#0A1628' },
        ],
        stock: 9,
        categoryId: 'cat-trench',
        collectionIds: ['col-lumiere-gold'],
        isPublished: true,
        isFeatured: true,
        isBestSeller: false,
        isNewArrival: true,
        showOnHomepage: true,
        salesCount: 38,
        createdAt: '2026-11-14T09:00:00.000Z',
        updatedAt: now,
      },
      {
        id: 'prod-obsidian-trousers',
        slug: 'orva-virgin-wool-pleated-trousers',
        name: 'بنطال صوف البكر بطيات أمامية',
        description:
          'بنطال رسمي بخصر عالٍ وطيات مزدوجة من الصوف البكر فائق النعومة، مزود بحزام جانبي جلدي لتعديل المقاس بدقة.',
        price: 6800,
        salePrice: null,
        showPrice: true,
        images: ['/src/assets/images/product_obsidian_trousers_1795105956411.jpg'],
        sizes: ['S', 'M', 'L', 'XL'],
        colors: [{ name: 'كحلي داكن', hex: '#0F1E36' }],
        stock: 18,
        categoryId: 'cat-trousers',
        collectionIds: ['col-atelier-midnight'],
        isPublished: true,
        isFeatured: true,
        isBestSeller: true,
        isNewArrival: false,
        showOnHomepage: true,
        salesCount: 77,
        createdAt: '2026-11-05T09:00:00.000Z',
        updatedAt: now,
      },
      {
        id: 'prod-merino-knit',
        slug: 'orva-merino-cashmere-knitwear',
        name: 'كنزة ميرينو كشمير بلمسة فضية',
        description:
          'تريكو فاخر محبوك من مزيج صوف الميرينو والكشمير بكثافة متوسطة تناسب الطبقات الشتوية الراقية.',
        price: 5900,
        salePrice: null,
        showPrice: true,
        images: ['/src/assets/images/collection_noir_capsule_1795105957687.jpg'],
        sizes: ['S', 'M', 'L', 'XL'],
        colors: [
          { name: 'كحلي ليلي', hex: '#0A1628' },
          { name: 'رمادي فضي', hex: '#94A3B8' },
        ],
        stock: 16,
        categoryId: 'cat-outerwear',
        collectionIds: ['col-atelier-midnight'],
        isPublished: true,
        isFeatured: false,
        isBestSeller: true,
        isNewArrival: true,
        showOnHomepage: true,
        salesCount: 53,
        createdAt: '2026-11-16T09:00:00.000Z',
        updatedAt: now,
      },
      {
        id: 'prod-atelier-overcoat',
        slug: 'orva-architectural-wool-overcoat',
        name: 'معطف أوفر كوت المعماري الفاخر',
        description:
          'القطعة الأيقونية لدار ORVA 7 لشتاء 2026: معطف صوف طويل بقصة معمارية نظيفة وحياكة يدوية دقيقة للحواف.',
        price: 18500,
        salePrice: 16200,
        showPrice: true,
        images: ['/src/assets/images/hero_orva_atelier_1795105957240.jpg'],
        sizes: ['M', 'L', 'XL'],
        colors: [{ name: 'كحلي ملكي', hex: '#0A1628' }],
        stock: 7,
        categoryId: 'cat-outerwear',
        collectionIds: ['col-atelier-midnight', 'col-lumiere-gold'],
        isPublished: true,
        isFeatured: true,
        isBestSeller: true,
        isNewArrival: true,
        showOnHomepage: true,
        salesCount: 49,
        createdAt: '2026-11-17T09:00:00.000Z',
        updatedAt: now,
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO products (
        id, slug, name, description, price, sale_price, show_price,
        images_json, sizes_json, colors_json, stock, category_id, collection_ids_json,
        is_published, is_featured, is_best_seller, is_new_arrival, show_on_homepage,
        sales_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of products) {
      stmt.run(
        p.id,
        p.slug,
        p.name,
        p.description,
        p.price,
        p.salePrice,
        p.showPrice ? 1 : 0,
        JSON.stringify(p.images),
        JSON.stringify(p.sizes),
        JSON.stringify(p.colors),
        p.stock,
        p.categoryId,
        JSON.stringify(p.collectionIds),
        p.isPublished ? 1 : 0,
        p.isFeatured ? 1 : 0,
        p.isBestSeller ? 1 : 0,
        p.isNewArrival ? 1 : 0,
        p.showOnHomepage ? 1 : 0,
        p.salesCount,
        p.createdAt,
        p.updatedAt
      );
    }
  }

  const offerCount = db.prepare('SELECT COUNT(*) as cnt FROM offers').get() as { cnt: number };
  if ((offerCount?.cnt || 0) === 0) {
    const offers: Offer[] = [
      {
        id: 'offer-winter-2026',
        title: 'عرض إطلاق موسم الشتاء 2026',
        bannerText: 'خصم 15% على مجموعة كحلي منتصف الليل لفترة محدودة',
        discountPercent: 15,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2027-03-01T23:59:59.000Z',
        targetType: 'collections',
        targetIds: ['col-atelier-midnight'],
        isActive: true,
        createdAt: now,
      },
    ];
    const stmt = db.prepare(
      'INSERT INTO offers (id, title, banner_text, discount_percent, start_date, end_date, target_type, target_ids_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const o of offers) {
      stmt.run(
        o.id,
        o.title,
        o.bannerText,
        o.discountPercent,
        o.startDate,
        o.endDate,
        o.targetType,
        JSON.stringify(o.targetIds),
        o.isActive ? 1 : 0,
        o.createdAt
      );
    }
  }

  const homepageRow = db.prepare("SELECT key FROM kv_config WHERE key = 'homepage'").get();
  if (!homepageRow) {
    const homepage: HomepageConfig = {
      heroKicker: 'إصدار خريف وشتاء 2026 · دار أورفا 7',
      heroTitle: 'هندسة الأناقة المعاصرة بتوقيع ORVA 7',
      heroDescription:
        'تصاميم معمارية دقيقة تجمع بين فخامة الكحلي الليلي، بريق الفضة المصقولة، ولمسات الذهب الهادئ في قطع صُممت لتدوم.',
      heroImage: '/src/assets/images/hero_orva_atelier_1795105957240.jpg',
      heroPrimaryCtaLabel: 'استكشف التشكيلة',
      heroPrimaryCtaLink: '#catalog',
      heroSecondaryCtaLabel: 'المجموعات الحصرية',
      heroSecondaryCtaLink: '#collections',
      featuredProductIds: [
        'prod-atelier-overcoat',
        'prod-navy-blazer',
        'prod-silver-shirt',
        'prod-gold-trench',
      ],
      featuredCategoryIds: ['cat-outerwear', 'cat-shirts', 'cat-trousers', 'cat-trench'],
      featuredCollectionIds: ['col-atelier-midnight', 'col-lumiere-gold'],
      promoBanners: [
        {
          id: 'banner-1',
          title: 'توصيل خاص وتغليف فاخر من دار ORVA 7',
          subtitle: 'شحن مؤمّن لجميع المحافظات مع إمكانية المعاينة والاستبدال خلال 14 يوماً.',
          ctaLabel: 'تسوق الأكثر مبيعاً',
          ctaLink: '#catalog',
          image: '/src/assets/images/collection_noir_capsule_1795105957687.jpg',
          isVisible: true,
        },
      ],
      sections: [
        { id: 'hero', label: 'القسم الرئيسي (Hero)', isVisible: true, order: 1 },
        { id: 'collections', label: 'المجموعات المختارة', isVisible: true, order: 2 },
        { id: 'featured', label: 'القطع المميزة والأكثر مبيعاً', isVisible: true, order: 3 },
        { id: 'catalog', label: 'المتجر والبحث المتقدم', isVisible: true, order: 4 },
        { id: 'banners', label: 'البنرات الترويجية', isVisible: true, order: 5 },
        { id: 'editorial', label: 'فلسفة الدار والحرفية', isVisible: true, order: 6 },
      ],
    };
    db.prepare('INSERT INTO kv_config (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'homepage',
      JSON.stringify(homepage),
      now
    );
  }

  const settingsRow = db.prepare("SELECT key FROM kv_config WHERE key = 'settings'").get();
  if (!settingsRow) {
    const settings: StoreSettings = {
      storeName: 'ORVA 7',
      logoUrl: '',
      storeDescription: 'دار أزياء معاصرة متخصصة في الخياطة المعمارية والأقمشة الطبيعية الفاخرة.',
      announcementText: 'إطلاق تشكيلة شتاء 2026 — شحن مجاني للطلبات فوق 8,000 ج.م',
      announcementVisible: true,
      currency: 'EGP',
      currencySymbol: 'ج.م',
      whatsappNumber: '+201098416124',
      contactEmail: 'atelier@orva7.com',
      contactPhone: '+201098416124',
      deliveryInfo: 'التوصيل خلال 2 إلى 4 أيام عمل داخل القاهرة والجيزة و3 إلى 5 أيام لباقي المحافظات.',
      returnPolicy: 'يحق للعميل الاستبدال أو الاسترجاع خلال 14 يوماً بشرط احتفاظ القطعة بحالتها الأصلية وبطاقة العلامة.',
      footerText: 'جميع الحقوق محفوظة © 2026 دار ORVA 7 للأزياء الفاخرة',
      socialLinks: {
        instagram: 'https://instagram.com',
        twitter: 'https://x.com',
        tiktok: 'https://tiktok.com',
        snapchat: 'https://snapchat.com',
      },
    };
    db.prepare('INSERT INTO kv_config (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'settings',
      JSON.stringify(settings),
      now
    );
  }

  const orderCount = db.prepare('SELECT COUNT(*) as cnt FROM orders').get() as { cnt: number };
  if ((orderCount?.cnt || 0) === 0) {
    const sampleOrder: Order = {
      id: 'ord-seed-1001',
      orderNumber: 'ORV-2026-1001',
      customerId: null,
      customerName: 'ندى السعيد',
      customerPhone: '01004567890',
      customerAddress: 'القاهرة الجديدة - التجمع الخامس',
      customerNotes: 'يرجى التواصل قبل الوصول بساعة',
      items: [
        {
          productId: 'prod-silver-shirt',
          productName: 'قميص حرير التوت الفضي',
          size: 'M',
          color: 'فضي بلاتيني',
          quantity: 1,
          unitPrice: 4590,
          lineTotal: 4590,
          image: '/src/assets/images/product_silver_silk_shirt_1795105956999.jpg',
        },
      ],
      subtotal: 4590,
      totalPrice: 4590,
      currencySymbol: 'ج.م',
      status: 'confirmed',
      paymentMethod: 'whatsapp_cod',
      paymentStatus: 'unpaid',
      paymentReference: '',
      paidAt: null,
      createdAt: '2026-11-18T14:30:00.000Z',
      updatedAt: '2026-11-18T15:00:00.000Z',
    };
    db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_phone, customer_address,
        customer_notes, items_json, subtotal, total_price, currency_symbol,
        status, payment_method, payment_status, payment_reference, paid_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sampleOrder.id,
      sampleOrder.orderNumber,
      sampleOrder.customerId,
      sampleOrder.customerName,
      sampleOrder.customerPhone,
      sampleOrder.customerAddress,
      sampleOrder.customerNotes,
      JSON.stringify(sampleOrder.items),
      sampleOrder.subtotal,
      sampleOrder.totalPrice,
      sampleOrder.currencySymbol,
      sampleOrder.status,
      sampleOrder.paymentMethod,
      sampleOrder.paymentStatus,
      sampleOrder.paymentReference,
      sampleOrder.paidAt,
      sampleOrder.createdAt,
      sampleOrder.updatedAt
    );
  }
}

seedInitialData();

function mapProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description || ''),
    price: Number(row.price || 0),
    salePrice: row.sale_price === null || row.sale_price === undefined ? null : Number(row.sale_price),
    showPrice: Boolean(row.show_price),
    images: parseJson(row.images_json, []),
    sizes: parseJson(row.sizes_json, []),
    colors: parseJson(row.colors_json, []),
    stock: Number(row.stock || 0),
    categoryId: row.category_id ? String(row.category_id) : null,
    collectionIds: parseJson(row.collection_ids_json, []),
    isPublished: Boolean(row.is_published),
    isFeatured: Boolean(row.is_featured),
    isBestSeller: Boolean(row.is_best_seller),
    isNewArrival: Boolean(row.is_new_arrival),
    showOnHomepage: Boolean(row.show_on_homepage),
    salesCount: Number(row.sales_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    parentId: row.parent_id ? String(row.parent_id) : null,
    image: String(row.image || ''),
    sortOrder: Number(row.sort_order || 0),
    isVisible: Boolean(row.is_visible),
    createdAt: String(row.created_at),
  };
}

function mapCollection(row: Record<string, unknown>): Collection {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description || ''),
    coverImage: String(row.cover_image || ''),
    productIds: parseJson(row.product_ids_json, []),
    isPublished: Boolean(row.is_published),
    sortOrder: Number(row.sort_order || 0),
    createdAt: String(row.created_at),
  };
}

function mapOffer(row: Record<string, unknown>): Offer {
  return {
    id: String(row.id),
    title: String(row.title),
    bannerText: String(row.banner_text || ''),
    discountPercent: Number(row.discount_percent || 0),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    targetType: (row.target_type as Offer['targetType']) || 'all',
    targetIds: parseJson(row.target_ids_json, []),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
  };
}

function mapOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    customerId: row.customer_id ? String(row.customer_id) : null,
    customerName: String(row.customer_name),
    customerPhone: String(row.customer_phone),
    customerAddress: String(row.customer_address || ''),
    customerNotes: String(row.customer_notes || ''),
    items: parseJson(row.items_json, []),
    subtotal: Number(row.subtotal || 0),
    totalPrice: Number(row.total_price || 0),
    currencySymbol: String(row.currency_symbol || 'ج.م'),
    status: (row.status as OrderStatus) || 'pending',
    paymentMethod: (row.payment_method as PaymentMethod) || 'whatsapp_cod',
    paymentStatus: (row.payment_status as PaymentStatus) || 'unpaid',
    paymentReference: String(row.payment_reference || ''),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCustomer(row: Record<string, unknown>): CustomerProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProductReview(row: Record<string, unknown>): ProductReview {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name),
    orderId: String(row.order_id),
    rating: Number(row.rating || 5),
    title: String(row.title || ''),
    comment: String(row.comment || ''),
    createdAt: String(row.created_at),
  };
}

export function getAdminUser(username: string): { id: string; username: string; passwordHash: string } | null {
  const row = db
    .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?')
    .get(username);
  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
  };
}

export function updateAdminPassword(username: string, newPasswordHash: string): void {
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(
    newPasswordHash,
    username
  );
}

export function isTokenRevoked(jti: string): boolean {
  const row = db.prepare('SELECT jti FROM revoked_tokens WHERE jti = ?').get(jti);
  return Boolean(row);
}

export function revokeToken(jti: string): void {
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, revoked_at) VALUES (?, ?)').run(
    jti,
    new Date().toISOString()
  );
}

export function listProducts(publishedOnly = false): Product[] {
  const sql = publishedOnly
    ? 'SELECT * FROM products WHERE is_published = 1 ORDER BY created_at DESC'
    : 'SELECT * FROM products ORDER BY created_at DESC';
  return db.prepare(sql).all().map(mapProduct);
}

export function getProductByIdOrSlug(idOrSlug: string): Product | null {
  const row = db
    .prepare('SELECT * FROM products WHERE id = ? OR slug = ?')
    .get(idOrSlug, idOrSlug);
  return row ? mapProduct(row) : null;
}

export function createProduct(input: Partial<Product>): Product {
  const now = new Date().toISOString();
  const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
  const name = String(input.name || '').trim();
  const baseSlug = slugify(input.slug || name);
  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(baseSlug);
  const slug = existing ? `${baseSlug}-${id.slice(-4)}` : baseSlug;

  const product: Product = {
    id,
    slug,
    name,
    description: String(input.description || '').trim(),
    price: Math.max(0, Number(input.price) || 0),
    salePrice:
      input.salePrice !== null && input.salePrice !== undefined && Number(input.salePrice) > 0
        ? Number(input.salePrice)
        : null,
    showPrice: input.showPrice !== undefined ? Boolean(input.showPrice) : true,
    images: Array.isArray(input.images) ? input.images.filter(Boolean) : [],
    sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : ['M', 'L'],
    colors: Array.isArray(input.colors) && input.colors.length
      ? input.colors
      : [{ name: 'كحلي ليلي', hex: '#0A1628' }],
    stock: Math.max(0, Math.floor(Number(input.stock) || 0)),
    categoryId: input.categoryId || null,
    collectionIds: Array.isArray(input.collectionIds) ? input.collectionIds : [],
    isPublished: input.isPublished !== undefined ? Boolean(input.isPublished) : true,
    isFeatured: Boolean(input.isFeatured),
    isBestSeller: Boolean(input.isBestSeller),
    isNewArrival: input.isNewArrival !== undefined ? Boolean(input.isNewArrival) : true,
    showOnHomepage: input.showOnHomepage !== undefined ? Boolean(input.showOnHomepage) : true,
    salesCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO products (
      id, slug, name, description, price, sale_price, show_price,
      images_json, sizes_json, colors_json, stock, category_id, collection_ids_json,
      is_published, is_featured, is_best_seller, is_new_arrival, show_on_homepage,
      sales_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.id,
    product.slug,
    product.name,
    product.description,
    product.price,
    product.salePrice,
    product.showPrice ? 1 : 0,
    JSON.stringify(product.images),
    JSON.stringify(product.sizes),
    JSON.stringify(product.colors),
    product.stock,
    product.categoryId,
    JSON.stringify(product.collectionIds),
    product.isPublished ? 1 : 0,
    product.isFeatured ? 1 : 0,
    product.isBestSeller ? 1 : 0,
    product.isNewArrival ? 1 : 0,
    product.showOnHomepage ? 1 : 0,
    product.salesCount,
    product.createdAt,
    product.updatedAt
  );

  syncProductCollections(product.id, product.collectionIds);
  return product;
}

export function updateProduct(id: string, input: Partial<Product>): Product | null {
  const existing = getProductByIdOrSlug(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated: Product = {
    ...existing,
    name: input.name !== undefined ? String(input.name).trim() : existing.name,
    description:
      input.description !== undefined ? String(input.description).trim() : existing.description,
    price: input.price !== undefined ? Math.max(0, Number(input.price) || 0) : existing.price,
    salePrice:
      input.salePrice !== undefined
        ? input.salePrice !== null && Number(input.salePrice) > 0
          ? Number(input.salePrice)
          : null
        : existing.salePrice,
    showPrice: input.showPrice !== undefined ? Boolean(input.showPrice) : existing.showPrice,
    images: Array.isArray(input.images) ? input.images.filter(Boolean) : existing.images,
    sizes: Array.isArray(input.sizes) ? input.sizes.filter(Boolean) : existing.sizes,
    colors: Array.isArray(input.colors) ? input.colors : existing.colors,
    stock: input.stock !== undefined ? Math.max(0, Math.floor(Number(input.stock) || 0)) : existing.stock,
    categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
    collectionIds: Array.isArray(input.collectionIds) ? input.collectionIds : existing.collectionIds,
    isPublished: input.isPublished !== undefined ? Boolean(input.isPublished) : existing.isPublished,
    isFeatured: input.isFeatured !== undefined ? Boolean(input.isFeatured) : existing.isFeatured,
    isBestSeller: input.isBestSeller !== undefined ? Boolean(input.isBestSeller) : existing.isBestSeller,
    isNewArrival: input.isNewArrival !== undefined ? Boolean(input.isNewArrival) : existing.isNewArrival,
    showOnHomepage:
      input.showOnHomepage !== undefined ? Boolean(input.showOnHomepage) : existing.showOnHomepage,
    updatedAt: now,
  };

  db.prepare(`
    UPDATE products SET
      name = ?, description = ?, price = ?, sale_price = ?, show_price = ?,
      images_json = ?, sizes_json = ?, colors_json = ?, stock = ?, category_id = ?,
      collection_ids_json = ?, is_published = ?, is_featured = ?, is_best_seller = ?,
      is_new_arrival = ?, show_on_homepage = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updated.name,
    updated.description,
    updated.price,
    updated.salePrice,
    updated.showPrice ? 1 : 0,
    JSON.stringify(updated.images),
    JSON.stringify(updated.sizes),
    JSON.stringify(updated.colors),
    updated.stock,
    updated.categoryId,
    JSON.stringify(updated.collectionIds),
    updated.isPublished ? 1 : 0,
    updated.isFeatured ? 1 : 0,
    updated.isBestSeller ? 1 : 0,
    updated.isNewArrival ? 1 : 0,
    updated.showOnHomepage ? 1 : 0,
    updated.updatedAt,
    existing.id
  );

  if (input.collectionIds !== undefined) {
    syncProductCollections(existing.id, updated.collectionIds);
  }

  return updated;
}

function syncProductCollections(productId: string, collectionIds: string[]): void {
  const allCols = listCollections(false);
  for (const col of allCols) {
    const shouldHave = collectionIds.includes(col.id);
    const hasNow = col.productIds.includes(productId);
    if (shouldHave && !hasNow) {
      const next = [...col.productIds, productId];
      db.prepare('UPDATE collections SET product_ids_json = ? WHERE id = ?').run(
        JSON.stringify(next),
        col.id
      );
    } else if (!shouldHave && hasNow) {
      const next = col.productIds.filter((pid) => pid !== productId);
      db.prepare('UPDATE collections SET product_ids_json = ? WHERE id = ?').run(
        JSON.stringify(next),
        col.id
      );
    }
  }
}

export function deleteProduct(id: string): boolean {
  const res = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (res.changes > 0) {
    syncProductCollections(id, []);
    return true;
  }
  return false;
}

export function listCategories(visibleOnly = false): Category[] {
  const sql = visibleOnly
    ? 'SELECT * FROM categories WHERE is_visible = 1 ORDER BY sort_order ASC, created_at ASC'
    : 'SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC';
  return db.prepare(sql).all().map(mapCategory);
}

export function createCategory(input: Partial<Category>): Category {
  const now = new Date().toISOString();
  const id = `cat-${crypto.randomUUID().slice(0, 8)}`;
  const name = String(input.name || '').trim();
  const category: Category = {
    id,
    name,
    slug: slugify(input.slug || name),
    parentId: input.parentId || null,
    image: String(input.image || ''),
    sortOrder: Number(input.sortOrder) || 0,
    isVisible: input.isVisible !== undefined ? Boolean(input.isVisible) : true,
    createdAt: now,
  };
  db.prepare(
    'INSERT INTO categories (id, name, slug, parent_id, image, sort_order, is_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    category.id,
    category.name,
    category.slug,
    category.parentId,
    category.image,
    category.sortOrder,
    category.isVisible ? 1 : 0,
    category.createdAt
  );
  return category;
}

export function updateCategory(id: string, input: Partial<Category>): Category | null {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!row) return null;
  const existing = mapCategory(row);
  const updated: Category = {
    ...existing,
    name: input.name !== undefined ? String(input.name).trim() : existing.name,
    slug: input.slug !== undefined ? slugify(input.slug) : existing.slug,
    parentId: input.parentId !== undefined ? input.parentId || null : existing.parentId,
    image: input.image !== undefined ? String(input.image) : existing.image,
    sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) || 0 : existing.sortOrder,
    isVisible: input.isVisible !== undefined ? Boolean(input.isVisible) : existing.isVisible,
  };
  db.prepare(
    'UPDATE categories SET name = ?, slug = ?, parent_id = ?, image = ?, sort_order = ?, is_visible = ? WHERE id = ?'
  ).run(
    updated.name,
    updated.slug,
    updated.parentId,
    updated.image,
    updated.sortOrder,
    updated.isVisible ? 1 : 0,
    id
  );
  return updated;
}

export function deleteCategory(id: string): boolean {
  db.prepare('UPDATE categories SET parent_id = NULL WHERE parent_id = ?').run(id);
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
  const res = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return res.changes > 0;
}

export function listCollections(publishedOnly = false): Collection[] {
  const sql = publishedOnly
    ? 'SELECT * FROM collections WHERE is_published = 1 ORDER BY sort_order ASC, created_at ASC'
    : 'SELECT * FROM collections ORDER BY sort_order ASC, created_at ASC';
  return db.prepare(sql).all().map(mapCollection);
}

export function createCollection(input: Partial<Collection>): Collection {
  const now = new Date().toISOString();
  const id = `col-${crypto.randomUUID().slice(0, 8)}`;
  const name = String(input.name || '').trim();
  const baseSlug = slugify(input.slug || name);
  const exists = db.prepare('SELECT id FROM collections WHERE slug = ?').get(baseSlug);
  const slug = exists ? `${baseSlug}-${id.slice(-4)}` : baseSlug;

  const col: Collection = {
    id,
    name,
    slug,
    description: String(input.description || '').trim(),
    coverImage: String(input.coverImage || ''),
    productIds: Array.isArray(input.productIds) ? input.productIds : [],
    isPublished: input.isPublished !== undefined ? Boolean(input.isPublished) : true,
    sortOrder: Number(input.sortOrder) || 0,
    createdAt: now,
  };

  db.prepare(
    'INSERT INTO collections (id, name, slug, description, cover_image, product_ids_json, is_published, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    col.id,
    col.name,
    col.slug,
    col.description,
    col.coverImage,
    JSON.stringify(col.productIds),
    col.isPublished ? 1 : 0,
    col.sortOrder,
    col.createdAt
  );
  syncCollectionOnProducts(col.id, col.productIds);
  return col;
}

export function updateCollection(id: string, input: Partial<Collection>): Collection | null {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!row) return null;
  const existing = mapCollection(row);
  const updated: Collection = {
    ...existing,
    name: input.name !== undefined ? String(input.name).trim() : existing.name,
    description:
      input.description !== undefined ? String(input.description).trim() : existing.description,
    coverImage: input.coverImage !== undefined ? String(input.coverImage) : existing.coverImage,
    productIds: Array.isArray(input.productIds) ? input.productIds : existing.productIds,
    isPublished: input.isPublished !== undefined ? Boolean(input.isPublished) : existing.isPublished,
    sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) || 0 : existing.sortOrder,
  };
  db.prepare(
    'UPDATE collections SET name = ?, description = ?, cover_image = ?, product_ids_json = ?, is_published = ?, sort_order = ? WHERE id = ?'
  ).run(
    updated.name,
    updated.description,
    updated.coverImage,
    JSON.stringify(updated.productIds),
    updated.isPublished ? 1 : 0,
    updated.sortOrder,
    id
  );
  if (input.productIds !== undefined) {
    syncCollectionOnProducts(id, updated.productIds);
  }
  return updated;
}

function syncCollectionOnProducts(collectionId: string, productIds: string[]): void {
  const allProducts = listProducts(false);
  for (const prod of allProducts) {
    const shouldHave = productIds.includes(prod.id);
    const hasNow = prod.collectionIds.includes(collectionId);
    if (shouldHave && !hasNow) {
      const next = [...prod.collectionIds, collectionId];
      db.prepare('UPDATE products SET collection_ids_json = ? WHERE id = ?').run(
        JSON.stringify(next),
        prod.id
      );
    } else if (!shouldHave && hasNow) {
      const next = prod.collectionIds.filter((cid) => cid !== collectionId);
      db.prepare('UPDATE products SET collection_ids_json = ? WHERE id = ?').run(
        JSON.stringify(next),
        prod.id
      );
    }
  }
}

export function deleteCollection(id: string): boolean {
  const res = db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  if (res.changes > 0) {
    syncCollectionOnProducts(id, []);
    return true;
  }
  return false;
}

export function listOffers(): Offer[] {
  return db.prepare('SELECT * FROM offers ORDER BY created_at DESC').all().map(mapOffer);
}

export function createOffer(input: Partial<Offer>): Offer {
  const now = new Date().toISOString();
  const id = `off-${crypto.randomUUID().slice(0, 8)}`;
  const offer: Offer = {
    id,
    title: String(input.title || '').trim(),
    bannerText: String(input.bannerText || '').trim(),
    discountPercent: Math.min(95, Math.max(1, Number(input.discountPercent) || 10)),
    startDate: String(input.startDate || now),
    endDate: String(input.endDate || new Date(Date.now() + 30 * 86400_000).toISOString()),
    targetType: (input.targetType as Offer['targetType']) || 'all',
    targetIds: Array.isArray(input.targetIds) ? input.targetIds : [],
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
    createdAt: now,
  };
  db.prepare(
    'INSERT INTO offers (id, title, banner_text, discount_percent, start_date, end_date, target_type, target_ids_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    offer.id,
    offer.title,
    offer.bannerText,
    offer.discountPercent,
    offer.startDate,
    offer.endDate,
    offer.targetType,
    JSON.stringify(offer.targetIds),
    offer.isActive ? 1 : 0,
    offer.createdAt
  );
  return offer;
}

export function updateOffer(id: string, input: Partial<Offer>): Offer | null {
  const row = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
  if (!row) return null;
  const existing = mapOffer(row);
  const updated: Offer = {
    ...existing,
    title: input.title !== undefined ? String(input.title).trim() : existing.title,
    bannerText: input.bannerText !== undefined ? String(input.bannerText).trim() : existing.bannerText,
    discountPercent:
      input.discountPercent !== undefined
        ? Math.min(95, Math.max(1, Number(input.discountPercent) || 1))
        : existing.discountPercent,
    startDate: input.startDate !== undefined ? String(input.startDate) : existing.startDate,
    endDate: input.endDate !== undefined ? String(input.endDate) : existing.endDate,
    targetType: input.targetType !== undefined ? input.targetType : existing.targetType,
    targetIds: Array.isArray(input.targetIds) ? input.targetIds : existing.targetIds,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : existing.isActive,
  };
  db.prepare(
    'UPDATE offers SET title = ?, banner_text = ?, discount_percent = ?, start_date = ?, end_date = ?, target_type = ?, target_ids_json = ?, is_active = ? WHERE id = ?'
  ).run(
    updated.title,
    updated.bannerText,
    updated.discountPercent,
    updated.startDate,
    updated.endDate,
    updated.targetType,
    JSON.stringify(updated.targetIds),
    updated.isActive ? 1 : 0,
    id
  );
  return updated;
}

export function deleteOffer(id: string): boolean {
  const res = db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  return res.changes > 0;
}

export function getHomepageConfig(): HomepageConfig {
  const row = db.prepare("SELECT value_json FROM kv_config WHERE key = 'homepage'").get();
  return parseJson(row?.value_json, {
    heroKicker: '',
    heroTitle: 'ORVA 7',
    heroDescription: '',
    heroImage: '',
    heroPrimaryCtaLabel: 'تسوق الآن',
    heroPrimaryCtaLink: '#catalog',
    heroSecondaryCtaLabel: 'المجموعات',
    heroSecondaryCtaLink: '#collections',
    featuredProductIds: [],
    featuredCategoryIds: [],
    featuredCollectionIds: [],
    promoBanners: [],
    sections: [],
  });
}

export function updateHomepageConfig(config: HomepageConfig): HomepageConfig {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO kv_config (key, value_json, updated_at) VALUES ('homepage', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
  ).run(JSON.stringify(config), now);
  return config;
}

export function getStoreSettings(): StoreSettings {
  const row = db.prepare("SELECT value_json FROM kv_config WHERE key = 'settings'").get();
  return parseJson(row?.value_json, {
    storeName: 'ORVA 7',
    logoUrl: '',
    storeDescription: '',
    announcementText: '',
    announcementVisible: false,
    currency: 'EGP',
    currencySymbol: 'ج.م',
    whatsappNumber: '+201098416124',
    contactEmail: '',
    contactPhone: '',
    deliveryInfo: '',
    returnPolicy: '',
    footerText: '',
    socialLinks: { instagram: '', twitter: '', tiktok: '', snapchat: '' },
  });
}

export function updateStoreSettings(settings: StoreSettings): StoreSettings {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO kv_config (key, value_json, updated_at) VALUES ('settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
  ).run(JSON.stringify(settings), now);
  return settings;
}

export function listOrders(): Order[] {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(mapOrder);
}

export function getOrderById(id: string): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return row ? mapOrder(row) : null;
}

export function listOrdersByCustomer(customerId: string, customerPhone?: string): Order[] {
  const all = listOrders();
  const cleanPhone = (customerPhone || '').replace(/[^\d]/g, '').slice(-10);
  return all.filter(
    (o) =>
      o.customerId === customerId ||
      (cleanPhone.length >= 8 && o.customerPhone.replace(/[^\d]/g, '').endsWith(cleanPhone))
  );
}

export function createOrderRecord(
  order: Omit<
    Order,
    | 'id'
    | 'orderNumber'
    | 'createdAt'
    | 'updatedAt'
    | 'customerId'
    | 'paymentMethod'
    | 'paymentStatus'
    | 'paymentReference'
    | 'paidAt'
  > & {
    customerId?: string | null;
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    paymentReference?: string;
    paidAt?: string | null;
  }
): Order {
  const now = new Date().toISOString();
  const id = `ord-${crypto.randomUUID().slice(0, 8)}`;
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM orders').get() as { cnt: number };
  const seq = 1001 + Number(countRow?.cnt || 0);
  const orderNumber = `ORV-${new Date().getFullYear()}-${seq}`;

  const created: Order = {
    ...order,
    id,
    orderNumber,
    customerId: order.customerId ?? null,
    paymentMethod: order.paymentMethod || 'whatsapp_cod',
    paymentStatus: order.paymentStatus || 'unpaid',
    paymentReference: order.paymentReference || '',
    paidAt: order.paidAt ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      INSERT INTO orders (
        id, order_number, customer_id, customer_name, customer_phone, customer_address,
        customer_notes, items_json, subtotal, total_price, currency_symbol,
        status, payment_method, payment_status, payment_reference, paid_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      created.id,
      created.orderNumber,
      created.customerId,
      created.customerName,
      created.customerPhone,
      created.customerAddress,
      created.customerNotes,
      JSON.stringify(created.items),
      created.subtotal,
      created.totalPrice,
      created.currencySymbol,
      created.status,
      created.paymentMethod,
      created.paymentStatus,
      created.paymentReference,
      created.paidAt,
      created.createdAt,
      created.updatedAt
    );

    const decStmt = db.prepare(
      'UPDATE products SET stock = MAX(0, stock - ?), sales_count = sales_count + ?, updated_at = ? WHERE id = ?'
    );
    for (const item of created.items) {
      decStmt.run(item.quantity, item.quantity, now, item.productId);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return created;
}

export function updateOrderStatus(id: string, status: OrderStatus): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return updated ? mapOrder(updated) : null;
}

export function updateOrderPayment(
  id: string,
  paymentStatus: PaymentStatus,
  paymentReference?: string,
  nextStatus?: OrderStatus
): Order | null {
  const existing = getOrderById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const paidAt = paymentStatus === 'paid' ? existing.paidAt || now : existing.paidAt;
  const status = nextStatus || existing.status;
  const ref = paymentReference !== undefined ? paymentReference : existing.paymentReference;
  db.prepare(
    'UPDATE orders SET payment_status = ?, payment_reference = ?, paid_at = ?, status = ?, updated_at = ? WHERE id = ?'
  ).run(paymentStatus, ref, paidAt, status, now, id);
  return getOrderById(id);
}

// ==========================================
// Customers, Wishlist & Verified Reviews
// ==========================================

export function getCustomerAuthByEmail(
  email: string
): { profile: CustomerProfile; passwordHash: string } | null {
  const cleanEmail = email.trim().toLowerCase();
  const row = db.prepare('SELECT * FROM customers WHERE LOWER(email) = ?').get(cleanEmail);
  if (!row) return null;
  return {
    profile: mapCustomer(row),
    passwordHash: String(row.password_hash),
  };
}

export function getCustomerById(id: string): CustomerProfile | null {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  return row ? mapCustomer(row) : null;
}

export function getCustomerPasswordHash(id: string): string | null {
  const row = db.prepare('SELECT password_hash FROM customers WHERE id = ?').get(id);
  return row ? String(row.password_hash) : null;
}

export function createCustomer(input: {
  name: string;
  email: string;
  phone: string;
  address?: string;
  passwordHash: string;
}): CustomerProfile {
  const now = new Date().toISOString();
  const id = `cust-${crypto.randomUUID().slice(0, 8)}`;
  const profile: CustomerProfile = {
    id,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    address: (input.address || '').trim(),
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    'INSERT INTO customers (id, name, email, phone, address, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    profile.id,
    profile.name,
    profile.email,
    profile.phone,
    profile.address,
    input.passwordHash,
    profile.createdAt,
    profile.updatedAt
  );
  return profile;
}

export function updateCustomerProfile(
  id: string,
  input: { name?: string; phone?: string; address?: string }
): CustomerProfile | null {
  const existing = getCustomerById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated: CustomerProfile = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    phone: input.phone !== undefined ? input.phone.trim() : existing.phone,
    address: input.address !== undefined ? input.address.trim() : existing.address,
    updatedAt: now,
  };
  db.prepare(
    'UPDATE customers SET name = ?, phone = ?, address = ?, updated_at = ? WHERE id = ?'
  ).run(updated.name, updated.phone, updated.address, updated.updatedAt, id);
  return updated;
}

export function updateCustomerPassword(id: string, newPasswordHash: string): void {
  db.prepare('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    newPasswordHash,
    new Date().toISOString(),
    id
  );
}

export function getWishlistProductIds(customerId: string): string[] {
  const rows = db
    .prepare('SELECT product_id FROM wishlist_items WHERE customer_id = ? ORDER BY created_at DESC')
    .all(customerId) as Array<{ product_id: string }>;
  return rows.map((r) => String(r.product_id));
}

export function addWishlistItem(customerId: string, productId: string): string[] {
  db.prepare(
    'INSERT OR IGNORE INTO wishlist_items (customer_id, product_id, created_at) VALUES (?, ?, ?)'
  ).run(customerId, productId, new Date().toISOString());
  return getWishlistProductIds(customerId);
}

export function removeWishlistItem(customerId: string, productId: string): string[] {
  db.prepare('DELETE FROM wishlist_items WHERE customer_id = ? AND product_id = ?').run(
    customerId,
    productId
  );
  return getWishlistProductIds(customerId);
}

export function listProductReviews(productId: string): ProductReview[] {
  return db
    .prepare('SELECT * FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC')
    .all(productId)
    .map(mapProductReview);
}

export function getReviewSummariesMap(): Map<string, ReviewSummary> {
  const rows = db.prepare('SELECT * FROM product_reviews').all().map(mapProductReview);
  const grouped = new Map<string, ProductReview[]>();
  for (const r of rows) {
    const arr = grouped.get(r.productId) || [];
    arr.push(r);
    grouped.set(r.productId, arr);
  }
  const map = new Map<string, ReviewSummary>();
  for (const [pid, revs] of grouped.entries()) {
    map.set(pid, computeReviewSummary(revs));
  }
  return map;
}

export function upsertProductReview(input: {
  productId: string;
  customerId: string;
  customerName: string;
  orderId: string;
  rating: number;
  title: string;
  comment: string;
}): ProductReview {
  const now = new Date().toISOString();
  const id = `rev-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO product_reviews (id, product_id, customer_id, customer_name, order_id, rating, title, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, customer_id) DO UPDATE SET
       rating = excluded.rating,
       title = excluded.title,
       comment = excluded.comment,
       customer_name = excluded.customer_name,
       order_id = excluded.order_id,
       created_at = excluded.created_at`
  ).run(
    id,
    input.productId,
    input.customerId,
    input.customerName,
    input.orderId,
    input.rating,
    input.title,
    input.comment,
    now
  );
  const row = db
    .prepare('SELECT * FROM product_reviews WHERE product_id = ? AND customer_id = ?')
    .get(input.productId, input.customerId);
  return mapProductReview(row as Record<string, unknown>);
}
