import crypto from 'node:crypto';
import type {
  Category,
  Collection,
  EffectivePricing,
  Offer,
  Order,
  OrderItem,
  Product,
  ProductQuery,
  ProductReview,
  ProductWithPricing,
  ReviewSummary,
  StoreSettings,
} from './types.ts';

export function slugify(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return cleaned || `item-${Date.now()}`;
}

export function isOfferActive(offer: Offer, nowMs: number = Date.now()): boolean {
  if (!offer.isActive) return false;
  const startMs = Date.parse(offer.startDate);
  const endMs = Date.parse(offer.endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return nowMs >= startMs && nowMs <= endMs;
}

export function computeEffectivePricing(
  product: Product,
  activeOffers: Offer[],
  nowMs: number = Date.now()
): EffectivePricing {
  const basePrice = Math.max(0, Number(product.price) || 0);
  let bestPrice =
    product.salePrice !== null &&
    product.salePrice !== undefined &&
    product.salePrice > 0 &&
    product.salePrice < basePrice
      ? Number(product.salePrice)
      : basePrice;

  let appliedOfferTitle: string | null = null;

  for (const offer of activeOffers) {
    if (!isOfferActive(offer, nowMs)) continue;
    const pct = Math.min(95, Math.max(1, Number(offer.discountPercent) || 0));
    const applies =
      offer.targetType === 'all' ||
      (offer.targetType === 'products' && offer.targetIds.includes(product.id)) ||
      (offer.targetType === 'collections' &&
        product.collectionIds.some((cid) => offer.targetIds.includes(cid)));

    if (!applies) continue;

    const offerPrice = Math.round((basePrice * (100 - pct)) / 100);
    if (offerPrice < bestPrice) {
      bestPrice = offerPrice;
      appliedOfferTitle = offer.title;
    }
  }

  const hasDiscount = basePrice > 0 && bestPrice < basePrice;
  const discountPercent = hasDiscount
    ? Math.round(((basePrice - bestPrice) / basePrice) * 100)
    : 0;

  return {
    basePrice,
    finalPrice: bestPrice,
    discountPercent,
    hasDiscount,
    appliedOfferTitle,
  };
}

export function collectCategoryAndDescendantIds(
  categoryId: string,
  categories: Category[]
): Set<string> {
  const ids = new Set<string>([categoryId]);
  let added = true;
  while (added) {
    added = false;
    for (const cat of categories) {
      if (cat.parentId && ids.has(cat.parentId) && !ids.has(cat.id)) {
        ids.add(cat.id);
        added = true;
      }
    }
  }
  return ids;
}

export function filterAndSortProducts(
  products: Product[],
  query: ProductQuery,
  activeOffers: Offer[],
  categories: Category[] = [],
  collections: Collection[] = [],
  nowMs: number = Date.now()
): ProductWithPricing[] {
  const enriched: ProductWithPricing[] = products.map((p) => ({
    ...p,
    pricing: computeEffectivePricing(p, activeOffers, nowMs),
  }));

  const searchLower = (query.search || '').trim().toLowerCase();
  const categoryNameMap = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));
  const collectionNameMap = new Map(collections.map((c) => [c.id, c.name.toLowerCase()]));

  const allowedCategoryIds = query.categoryId
    ? collectCategoryAndDescendantIds(query.categoryId, categories)
    : null;

  const filtered = enriched.filter((p) => {
    if (searchLower) {
      const catName = p.categoryId ? categoryNameMap.get(p.categoryId) || '' : '';
      const colNames = p.collectionIds
        .map((cid) => collectionNameMap.get(cid) || '')
        .join(' ');
      const haystack = `${p.name} ${p.description} ${catName} ${colNames}`.toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }

    if (allowedCategoryIds) {
      if (!p.categoryId || !allowedCategoryIds.has(p.categoryId)) return false;
    }

    if (query.collectionId) {
      const col = collections.find((c) => c.id === query.collectionId);
      const inProductCols = p.collectionIds.includes(query.collectionId);
      const inCollectionProducts = col ? col.productIds.includes(p.id) : false;
      if (!inProductCols && !inCollectionProducts) return false;
    }

    if (query.size && !p.sizes.includes(query.size)) {
      return false;
    }

    if (query.color) {
      const targetColor = query.color.trim().toLowerCase();
      const hasColor = p.colors.some(
        (c) => c.name.toLowerCase() === targetColor || c.hex.toLowerCase() === targetColor
      );
      if (!hasColor) return false;
    }

    if (typeof query.minPrice === 'number' && !Number.isNaN(query.minPrice)) {
      if (p.pricing.finalPrice < query.minPrice) return false;
    }

    if (typeof query.maxPrice === 'number' && !Number.isNaN(query.maxPrice)) {
      if (p.pricing.finalPrice > query.maxPrice) return false;
    }

    if (query.onSaleOnly && !p.pricing.hasDiscount) return false;
    if (query.newArrivalOnly && !p.isNewArrival) return false;
    if (query.bestSellerOnly && !p.isBestSeller) return false;
    if (query.featuredOnly && !p.isFeatured) return false;

    return true;
  });

  const sortMode = query.sort || 'featured';
  filtered.sort((a, b) => {
    switch (sortMode) {
      case 'price_asc':
        return a.pricing.finalPrice - b.pricing.finalPrice;
      case 'price_desc':
        return b.pricing.finalPrice - a.pricing.finalPrice;
      case 'best_selling':
        return b.salesCount - a.salesCount || Date.parse(b.createdAt) - Date.parse(a.createdAt);
      case 'newest':
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      case 'featured':
      default:
        return (
          Number(b.isFeatured) - Number(a.isFeatured) ||
          Number(b.isNewArrival) - Number(a.isNewArrival) ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt)
        );
    }
  });

  return filtered;
}

export interface OrderDraftInput {
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerNotes?: string;
  items: Array<{
    productId: string;
    size: string;
    color: string;
    quantity: number;
  }>;
}

export function validateOrderPayload(
  input: OrderDraftInput,
  productsById: Map<string, Product>,
  activeOffers: Offer[],
  nowMs: number = Date.now()
): {
  ok: true;
  items: OrderItem[];
  subtotal: number;
  totalPrice: number;
} | {
  ok: false;
  error: string;
} {
  const customerName = (input.customerName || '').trim();
  const customerPhone = (input.customerPhone || '').trim();

  if (customerName.length < 2) {
    return { ok: false, error: 'يرجى إدخال الاسم الكامل بشكل صحيح.' };
  }
  if (customerPhone.replace(/[^\d+]/g, '').length < 8) {
    return { ok: false, error: 'يرجى إدخال رقم هاتف صحيح للتواصل.' };
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: 'حقيبة التسوق فارغة.' };
  }

  const orderItems: OrderItem[] = [];
  let subtotal = 0;

  for (const rawItem of input.items) {
    const product = productsById.get(rawItem.productId);
    if (!product || !product.isPublished) {
      return { ok: false, error: 'أحد المنتجات المختارة غير متاح حالياً.' };
    }
    const qty = Math.floor(Number(rawItem.quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      return { ok: false, error: `الكمية غير صالحة للمنتج: ${product.name}` };
    }
    if (qty > product.stock) {
      return {
        ok: false,
        error: `الكمية المطلوبة من "${product.name}" تتجاوز المخزون المتاح (${product.stock}).`,
      };
    }

    const pricing = computeEffectivePricing(product, activeOffers, nowMs);
    const lineTotal = pricing.finalPrice * qty;
    subtotal += lineTotal;

    orderItems.push({
      productId: product.id,
      productName: product.name,
      size: (rawItem.size || product.sizes[0] || 'M').trim(),
      color: (rawItem.color || product.colors[0]?.name || 'أساسي').trim(),
      quantity: qty,
      unitPrice: pricing.finalPrice,
      lineTotal,
      image: product.images[0] || '',
    });
  }

  return {
    ok: true,
    items: orderItems,
    subtotal,
    totalPrice: subtotal,
  };
}

export function normalizeWhatsAppDigits(phone: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  return digits || '201098416124';
}

export function buildWhatsAppOrderMessage(
  order: Order,
  settings: StoreSettings
): { message: string; url: string } {
  const currency = settings.currencySymbol || order.currencySymbol || 'ج.م';
  const lines: string[] = [
    `طلب جديد من متجر ${settings.storeName || 'ORVA 7'}`,
    `رقم الطلب: ${order.orderNumber}`,
    `--------------------------------`,
    `الاسم: ${order.customerName}`,
    `الهاتف: ${order.customerPhone}`,
  ];

  if (order.customerAddress.trim()) {
    lines.push(`العنوان: ${order.customerAddress.trim()}`);
  }
  if (order.customerNotes.trim()) {
    lines.push(`ملاحظات: ${order.customerNotes.trim()}`);
  }

  lines.push(`--------------------------------`);
  lines.push(`المنتجات:`);

  order.items.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. ${item.productName} | المقاس: ${item.size} | اللون: ${item.color} | الكمية: ${item.quantity} × ${item.unitPrice} ${currency} = ${item.lineTotal} ${currency}`
    );
  });

  lines.push(`--------------------------------`);
  lines.push(`الإجمالي النهائي: ${order.totalPrice} ${currency}`);

  const message = lines.join('\n');
  const waDigits = normalizeWhatsAppDigits(settings.whatsappNumber);
  const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(message)}`;
  return { message, url };
}

export function hashPassword(password: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export function signSessionToken(
  payload: { username: string; exp: number; jti: string; role?: 'admin' },
  secret: string
): string {
  const fullPayload = { ...payload, role: 'admin' as const };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): { username: string; exp: number; jti: string } | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      username: string;
      exp: number;
      jti: string;
      role?: string;
    };
    if (!parsed || typeof parsed.username !== 'string' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (parsed.role && parsed.role !== 'admin') return null;
    if (nowMs > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signCustomerToken(
  payload: { customerId: string; email: string; exp: number; jti: string },
  secret: string
): string {
  const fullPayload = { ...payload, role: 'customer' as const };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyCustomerToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): { customerId: string; email: string; exp: number; jti: string } | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      customerId: string;
      email: string;
      exp: number;
      jti: string;
      role?: string;
    };
    if (
      !parsed ||
      parsed.role !== 'customer' ||
      typeof parsed.customerId !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (nowMs > parsed.exp) return null;
    return {
      customerId: parsed.customerId,
      email: parsed.email,
      exp: parsed.exp,
      jti: parsed.jti,
    };
  } catch {
    return null;
  }
}

export function normalizePhoneDigits(phone: string): string {
  return (phone || '').replace(/[^\d]/g, '').slice(-10);
}

export function findEligibleOrderForReview(
  customerId: string,
  customerPhone: string,
  productId: string,
  orders: Order[]
): Order | null {
  const cleanCustPhone = normalizePhoneDigits(customerPhone);
  for (const ord of orders) {
    if (ord.status === 'cancelled') continue;
    const belongsById = ord.customerId === customerId;
    const belongsByPhone =
      cleanCustPhone.length >= 8 && normalizePhoneDigits(ord.customerPhone) === cleanCustPhone;
    if (!belongsById && !belongsByPhone) continue;
    if (ord.items.some((item) => item.productId === productId)) {
      return ord;
    }
  }
  return null;
}

export function validateReviewInput(input: {
  rating?: number;
  title?: string;
  comment?: string;
}): { ok: true; rating: number; title: string; comment: string } | { ok: false; error: string } {
  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'يرجى اختيار تقييم من 1 إلى 5 نجوم.' };
  }
  const title = (input.title || '').trim().slice(0, 120);
  const comment = (input.comment || '').trim();
  if (comment.length < 4) {
    return { ok: false, error: 'يرجى كتابة تعليق لا يقل عن 4 أحرف.' };
  }
  if (comment.length > 1000) {
    return { ok: false, error: 'التعليق طويل جداً (الحد الأقصى 1000 حرف).' };
  }
  return { ok: true, rating, title, comment };
}

export function computeReviewSummary(reviews: ProductReview[]): ReviewSummary {
  if (!reviews.length) {
    return { averageRating: 0, reviewCount: 0 };
  }
  const total = reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0);
  return {
    averageRating: Number((total / reviews.length).toFixed(1)),
    reviewCount: reviews.length,
  };
}

export function luhnCheck(cardNumber: string): boolean {
  const digits = (cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateCardPaymentInput(
  input: {
    cardNumber?: string;
    expiry?: string;
    cvv?: string;
    cardHolder?: string;
  },
  nowDate: Date = new Date()
): { ok: true; last4: string; brand: string } | { ok: false; error: string } {
  const holder = (input.cardHolder || '').trim();
  if (holder.length < 2) {
    return { ok: false, error: 'يرجى إدخال اسم حامل البطاقة.' };
  }
  const digits = (input.cardNumber || '').replace(/[\s-]/g, '');
  if (!luhnCheck(digits)) {
    return { ok: false, error: 'رقم البطاقة البنكية غير صحيح.' };
  }
  const expMatch = /^(\d{2})\/(\d{2,4})$/.exec((input.expiry || '').trim());
  if (!expMatch) {
    return { ok: false, error: 'يرجى إدخال تاريخ الانتهاء بصيغة MM/YY.' };
  }
  const month = Number(expMatch[1]);
  const rawYear = Number(expMatch[2]);
  const year = expMatch[2].length === 2 ? 2000 + rawYear : rawYear;
  if (month < 1 || month > 12) {
    return { ok: false, error: 'شهر انتهاء البطاقة غير صحيح.' };
  }
  const curYear = nowDate.getUTCFullYear();
  const curMonth = nowDate.getUTCMonth() + 1;
  if (year < curYear || (year === curYear && month < curMonth)) {
    return { ok: false, error: 'البطاقة منتهية الصلاحية.' };
  }
  const cvv = (input.cvv || '').trim();
  if (!/^\d{3,4}$/.test(cvv)) {
    return { ok: false, error: 'رمز الأمان (CVV) غير صحيح.' };
  }

  let brand = 'Card';
  if (digits.startsWith('4')) brand = 'Visa';
  else if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) brand = 'Mastercard';
  else if (digits.startsWith('5078')) brand = 'Meeza';

  return { ok: true, last4: digits.slice(-4), brand };
}
