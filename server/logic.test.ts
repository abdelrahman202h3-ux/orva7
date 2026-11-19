import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhatsAppOrderMessage,
  computeEffectivePricing,
  computeReviewSummary,
  filterAndSortProducts,
  findEligibleOrderForReview,
  hashPassword,
  isOfferActive,
  luhnCheck,
  signCustomerToken,
  signSessionToken,
  validateCardPaymentInput,
  validateOrderPayload,
  validateReviewInput,
  verifyCustomerToken,
  verifyPassword,
  verifySessionToken,
} from './logic.ts';
import type {
  Category,
  Collection,
  Offer,
  Order,
  Product,
  ProductReview,
  StoreSettings,
} from './types.ts';

const baseProduct: Product = {
  id: 'p1',
  slug: 'navy-blazer',
  name: 'بليزر كشمير كحلي',
  description: 'تصميم معماري مزدوج الصدر من صوف الكشمير الفاخر.',
  price: 10000,
  salePrice: null,
  showPrice: true,
  images: ['/img/1.jpg'],
  sizes: ['S', 'M', 'L'],
  colors: [{ name: 'كحلي ليلي', hex: '#0A1628' }],
  stock: 8,
  categoryId: 'cat1',
  collectionIds: ['col1'],
  isPublished: true,
  isFeatured: true,
  isBestSeller: true,
  isNewArrival: true,
  showOnHomepage: true,
  salesCount: 42,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const secondProduct: Product = {
  ...baseProduct,
  id: 'p2',
  slug: 'silver-shirt',
  name: 'قميص حرير بلاتيني',
  description: 'حرير التوت الطبيعي بلمسة فضية معدنية.',
  price: 4000,
  salePrice: 3600,
  sizes: ['M', 'XL'],
  colors: [{ name: 'فضي معدني', hex: '#C4CCD6' }],
  stock: 5,
  categoryId: 'cat2',
  collectionIds: ['col2'],
  isFeatured: false,
  isBestSeller: false,
  isNewArrival: true,
  salesCount: 15,
  createdAt: '2026-11-01T10:00:00.000Z',
};

const sampleCategories: Category[] = [
  {
    id: 'cat1',
    name: 'البليزر والمعاطف',
    slug: 'blazers',
    parentId: null,
    image: '',
    sortOrder: 1,
    isVisible: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'cat1-sub',
    name: 'بليزر رسمي',
    slug: 'formal-blazers',
    parentId: 'cat1',
    image: '',
    sortOrder: 2,
    isVisible: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'cat2',
    name: 'القمصان الحريرية',
    slug: 'silk-shirts',
    parentId: null,
    image: '',
    sortOrder: 3,
    isVisible: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

const sampleCollections: Collection[] = [
  {
    id: 'col1',
    name: 'مجموعة منتصف الليل',
    slug: 'midnight',
    description: '',
    coverImage: '',
    productIds: ['p1'],
    isPublished: true,
    sortOrder: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

test('active vs expired offers and best discount precedence', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');
  const activeOffer: Offer = {
    id: 'off1',
    title: 'عرض الشتاء الحصري',
    bannerText: 'خصم 25%',
    discountPercent: 25,
    startDate: '2026-11-01T00:00:00.000Z',
    endDate: '2026-11-30T23:59:59.000Z',
    targetType: 'collections',
    targetIds: ['col1'],
    isActive: true,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
  const expiredOffer: Offer = {
    ...activeOffer,
    id: 'off2',
    title: 'عرض منتهي',
    discountPercent: 50,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-02-01T00:00:00.000Z',
  };

  assert.equal(isOfferActive(activeOffer, now), true);
  assert.equal(isOfferActive(expiredOffer, now), false);

  const pricing = computeEffectivePricing(baseProduct, [activeOffer, expiredOffer], now);
  assert.equal(pricing.finalPrice, 7500);
  assert.equal(pricing.discountPercent, 25);
  assert.equal(pricing.appliedOfferTitle, 'عرض الشتاء الحصري');
});

test('multi-filtering across search, size, color, price, and sorting', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');
  const results = filterAndSortProducts(
    [baseProduct, secondProduct],
    {
      search: 'حرير',
      size: 'XL',
      color: 'فضي معدني',
      maxPrice: 3800,
      sort: 'price_asc',
    },
    [],
    sampleCategories,
    sampleCollections,
    now
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'p2');
  assert.equal(results[0].pricing.finalPrice, 3600);
});

test('filtering by parent category includes descendant subcategories', () => {
  const subProduct: Product = {
    ...baseProduct,
    id: 'p3',
    categoryId: 'cat1-sub',
  };
  const results = filterAndSortProducts(
    [subProduct, secondProduct],
    { categoryId: 'cat1' },
    [],
    sampleCategories,
    sampleCollections
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'p3');
});

test('order payload validation enforces stock limits and computes totals server-side', () => {
  const map = new Map<string, Product>([
    [baseProduct.id, baseProduct],
    [secondProduct.id, secondProduct],
  ]);

  const badStock = validateOrderPayload(
    {
      customerName: 'سارة أحمد',
      customerPhone: '01098416124',
      items: [{ productId: 'p1', size: 'M', color: 'كحلي ليلي', quantity: 99 }],
    },
    map,
    []
  );
  assert.equal(badStock.ok, false);

  const valid = validateOrderPayload(
    {
      customerName: 'سارة أحمد',
      customerPhone: '01098416124',
      customerAddress: 'القاهرة - الزمالك',
      items: [
        { productId: 'p1', size: 'M', color: 'كحلي ليلي', quantity: 1 },
        { productId: 'p2', size: 'M', color: 'فضي معدني', quantity: 2 },
      ],
    },
    map,
    []
  );

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.totalPrice, 10000 + 3600 * 2);
    assert.equal(valid.items.length, 2);
  }
});

test('WhatsApp order message includes product summary and targets +201098416124', () => {
  const order: Order = {
    id: 'o1',
    orderNumber: 'ORV-2026-1001',
    customerId: null,
    customerName: 'أحمد محمود',
    customerPhone: '01012345678',
    customerAddress: 'الجيزة - الشيخ زايد',
    customerNotes: 'التوصيل مساءً',
    items: [
      {
        productId: 'p1',
        productName: 'بليزر كشمير كحلي',
        size: 'L',
        color: 'كحلي ليلي',
        quantity: 2,
        unitPrice: 7500,
        lineTotal: 15000,
        image: '',
      },
    ],
    subtotal: 15000,
    totalPrice: 15000,
    currencySymbol: 'ج.م',
    status: 'pending',
    paymentMethod: 'whatsapp_cod',
    paymentStatus: 'unpaid',
    paymentReference: '',
    paidAt: null,
    createdAt: '2026-11-15T12:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
  };

  const settings: StoreSettings = {
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
  };

  const { message, url } = buildWhatsAppOrderMessage(order, settings);
  assert.ok(url.startsWith('https://wa.me/201098416124?text='));
  assert.ok(message.includes('ORV-2026-1001'));
  assert.ok(message.includes('بليزر كشمير كحلي'));
  assert.ok(message.includes('15000'));
});

test('password hashing and HMAC session tokens verify securely with role isolation', () => {
  const hash = hashPassword('Orva7Secret!');
  assert.equal(verifyPassword('Orva7Secret!', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);

  const secret = 'test-hmac-secret';
  const now = 1_700_000_000_000;
  const adminToken = signSessionToken({ username: 'admin', exp: now + 60_000, jti: 'j1' }, secret);
  const verifiedAdmin = verifySessionToken(adminToken, secret, now + 1000);
  assert.equal(verifiedAdmin?.username, 'admin');
  assert.equal(verifySessionToken(adminToken, secret, now + 120_000), null);
  assert.equal(verifySessionToken(`${adminToken}tampered`, secret, now + 1000), null);

  const custToken = signCustomerToken(
    { customerId: 'cust-1', email: 'sara@example.com', exp: now + 60_000, jti: 'jc1' },
    secret
  );
  const verifiedCust = verifyCustomerToken(custToken, secret, now + 1000);
  assert.equal(verifiedCust?.customerId, 'cust-1');
  assert.equal(verifySessionToken(custToken, secret, now + 1000), null);
  assert.equal(verifyCustomerToken(adminToken, secret, now + 1000), null);
});

test('verified purchase review eligibility, validation, and rating summary work accurately', () => {
  const sampleOrders: Order[] = [
    {
      id: 'ord-cancelled',
      orderNumber: 'ORV-1',
      customerId: 'cust-1',
      customerName: 'سارة',
      customerPhone: '01098416124',
      customerAddress: '',
      customerNotes: '',
      items: [
        {
          productId: 'p1',
          productName: 'بليزر',
          size: 'M',
          color: 'كحلي',
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000,
          image: '',
        },
      ],
      subtotal: 1000,
      totalPrice: 1000,
      currencySymbol: 'ج.م',
      status: 'cancelled',
      paymentMethod: 'whatsapp_cod',
      paymentStatus: 'unpaid',
      paymentReference: '',
      paidAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 'ord-paid',
      orderNumber: 'ORV-2',
      customerId: 'cust-1',
      customerName: 'سارة',
      customerPhone: '01098416124',
      customerAddress: '',
      customerNotes: '',
      items: [
        {
          productId: 'p2',
          productName: 'قميص',
          size: 'M',
          color: 'فضي',
          quantity: 1,
          unitPrice: 3600,
          lineTotal: 3600,
          image: '',
        },
      ],
      subtotal: 3600,
      totalPrice: 3600,
      currencySymbol: 'ج.م',
      status: 'confirmed',
      paymentMethod: 'online_card',
      paymentStatus: 'paid',
      paymentReference: 'ORVPAY-1234',
      paidAt: '2026-11-02T00:00:00.000Z',
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    },
  ];

  assert.equal(findEligibleOrderForReview('cust-1', '01098416124', 'p1', sampleOrders), null);
  assert.equal(findEligibleOrderForReview('cust-1', '01098416124', 'p2', sampleOrders)?.id, 'ord-paid');
  assert.equal(findEligibleOrderForReview('cust-other', '01000000000', 'p2', sampleOrders), null);

  assert.equal(validateReviewInput({ rating: 6, comment: 'ممتاز جداً' }).ok, false);
  assert.equal(validateReviewInput({ rating: 5, comment: 'لا' }).ok, false);
  assert.equal(validateReviewInput({ rating: 5, title: 'ممتاز', comment: 'خامة راقية جداً' }).ok, true);

  const revs: ProductReview[] = [
    {
      id: 'r1',
      productId: 'p2',
      customerId: 'c1',
      customerName: 'سارة',
      orderId: 'ord-paid',
      rating: 5,
      title: '',
      comment: 'ممتاز',
      createdAt: '',
    },
    {
      id: 'r2',
      productId: 'p2',
      customerId: 'c2',
      customerName: 'منى',
      orderId: 'ord-paid-2',
      rating: 4,
      title: '',
      comment: 'جيد جداً',
      createdAt: '',
    },
  ];
  assert.deepEqual(computeReviewSummary(revs), { averageRating: 4.5, reviewCount: 2 });
  assert.deepEqual(computeReviewSummary([]), { averageRating: 0, reviewCount: 0 });
});

test('Luhn check and online card validation enforce valid cards and reject expired ones', () => {
  assert.equal(luhnCheck('4242424242424242'), true);
  assert.equal(luhnCheck('4242424242424241'), false);

  const refNow = new Date('2026-11-19T00:00:00.000Z');
  const valid = validateCardPaymentInput(
    {
      cardHolder: 'Sara Ahmed',
      cardNumber: '4242 4242 4242 4242',
      expiry: '12/28',
      cvv: '424',
    },
    refNow
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.brand, 'Visa');
    assert.equal(valid.last4, '4242');
  }

  const expired = validateCardPaymentInput(
    {
      cardHolder: 'Sara Ahmed',
      cardNumber: '4242 4242 4242 4242',
      expiry: '01/25',
      cvv: '424',
    },
    refNow
  );
  assert.equal(expired.ok, false);
});
