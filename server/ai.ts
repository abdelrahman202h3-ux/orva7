import { GoogleGenAI } from '@google/genai';
import type {
  Category,
  Collection,
  Offer,
  Product,
  ReviewSummary,
  StoreSettings,
} from './types.ts';
import { computeEffectivePricing } from './logic.ts';

export const ORVA_AI_MODEL = 'gemini-4-hydrogen';

export interface StoreKnowledgeSnapshot {
  settings: StoreSettings;
  categories: Category[];
  collections: Collection[];
  activeOffers: Offer[];
  products: Product[];
  reviewSummaries: Map<string, ReviewSummary>;
}

export function buildStoreSystemInstruction(snapshot: StoreKnowledgeSnapshot): string {
  const { settings, categories, collections, activeOffers, products, reviewSummaries } = snapshot;
  const currency = settings.currencySymbol || 'ج.م';
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const colMap = new Map(collections.map((c) => [c.id, c.name]));
  const nowMs = Date.now();

  const productLines = products.map((p) => {
    const pricing = computeEffectivePricing(p, activeOffers, nowMs);
    const catName = p.categoryId ? catMap.get(p.categoryId) || 'غير مصنف' : 'عام';
    const colNames = p.collectionIds.map((cid) => colMap.get(cid)).filter(Boolean).join('، ');
    const colors = p.colors.map((c) => c.name).join('، ');
    const sizes = p.sizes.join('، ');
    const rev = reviewSummaries.get(p.id);
    const ratingStr =
      rev && rev.reviewCount > 0 ? `التقييم: ${rev.averageRating}/5 (${rev.reviewCount} تقييم)` : 'لا توجد تقييمات بعد';

    const priceStr = p.showPrice
      ? pricing.hasDiscount
        ? `${pricing.finalPrice} ${currency} (بدلاً من ${pricing.basePrice} ${currency} — خصم ${pricing.discountPercent}%${pricing.appliedOfferTitle ? ` ضمن ${pricing.appliedOfferTitle}` : ''})`
        : `${pricing.basePrice} ${currency}`
      : 'السعر عند التواصل';

    const stockStr = p.stock > 0 ? `متوفر (${p.stock} قطعة)` : 'غير متوفر حالياً (نفذت الكمية)';

    return `- [${p.name}] | الفئة: ${catName}${colNames ? ` | المجموعات: ${colNames}` : ''} | السعر: ${priceStr} | المقاسات: ${sizes} | الألوان: ${colors} | الحالة: ${stockStr} | ${ratingStr} | الوصف: ${p.description}`;
  });

  const offerLines = activeOffers.length
    ? activeOffers.map(
        (o) => `- ${o.title}: خصم ${o.discountPercent}% (${o.bannerText || 'عرض فعّال الآن'})`
      )
    : ['- لا توجد عروض ترويجية عامة نشطة حالياً غير التخفيضات المذكورة على المنتجات.'];

  const waDigits = (settings.whatsappNumber || '+201098416124').replace(/[^\d]/g, '');

  return `أنت مستشار خدمة عملاء ذكي ومحترف لمتجر الأزياء الفاخرة "${settings.storeName || 'ORVA 7'}".

قواعد الشخصية والأسلوب:
1. تحدث بالعامية المصرية الراقية والودودة والطبيعية افتراضياً (إلا إذا خاطبك العميل بلغة أخرى واضحة).
2. افهم العامية المصرية والأخطاء الإملائية الشائعة بسلاسة.
3. اجعل إجاباتك واضحة، مختصرة ومفيدة بدون إطالة مملة، واسأل أسئلة توضيحية لطيفة عند الحاجة (مثل سؤال العميل عن المقاس أو المناسبة أو اللون المفضل).
4. لا تخترع أبداً أي منتجات أو أسعار أو مقاسات أو ألوان أو خصومات أو وعود توصيل غير موجودة في بيانات المتجر بالأسفل.
5. إذا لم تجد معلومة أكيدة أو احتاج العميل مساعدة بشرية/تعديل خاص، اعترف بوضوح ووجهه للتواصل مع خدمة العملاء الرسمية على واتساب: ${settings.whatsappNumber || '+201098416124'} عبر الرابط https://wa.me/${waDigits} .
6. ساعد العميل في خطوات الطلب: سواء الدفع الإلكتروني الآمن (بطاقة بنكية أو محفظة إلكترونية) داخل صفحة الدفع، أو الطلب السريع عبر واتساب من حقيبة التسوق.

بيانات المتجر الحالية (محدّثة لحظياً من قاعدة البيانات):
- اسم المتجر: ${settings.storeName || 'ORVA 7'}
- نبذة عن الدار: ${settings.storeDescription}
- العملة: ${currency}
- سياسة التوصيل والشحن: ${settings.deliveryInfo}
- سياسة الاستبدال والاسترجاع: ${settings.returnPolicy}
- البريد الإلكتروني: ${settings.contactEmail || 'atelier@orva7.com'}
- رقم واتساب الرسمي للطلبات وخدمة العملاء: ${settings.whatsappNumber || '+201098416124'} (https://wa.me/${waDigits})

العروض النشطة حالياً:
${offerLines.join('\n')}

الفئات المتوفرة:
${categories.map((c) => `- ${c.name}`).join('\n') || '- لا توجد فئات'}

المجموعات المتوفرة:
${collections.map((c) => `- ${c.name}: ${c.description}`).join('\n') || '- لا توجد مجموعات'}

المنتجات المنشورة حالياً في قاعدة البيانات:
${productLines.join('\n') || '- لا توجد منتجات منشورة حالياً.'}`;
}

export interface ChatTurnInput {
  role: 'user' | 'model';
  text: string;
}

function extractApiStatusCode(err: unknown): number {
  if (err && typeof err === 'object') {
    const anyErr = err as { status?: number; statusCode?: number; message?: string };
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.message === 'string') {
      try {
        const parsed = JSON.parse(anyErr.message) as { error?: { code?: number } };
        if (typeof parsed?.error?.code === 'number') return parsed.error.code;
      } catch {
        // not JSON
      }
    }
  }
  return 500;
}

function formatArabicAiError(err: unknown, statusCode: number): Error & { statusCode: number } {
  let msg = 'خدمة المساعد الذكي تواجه ضغطاً مؤقتاً الآن. يرجى المحاولة بعد لحظات أو التواصل عبر واتساب.';
  if (statusCode === 503) {
    msg = 'نموذج المساعد الذكي يشهد إقبالاً مرتفعاً حالياً. يرجى المحاولة بعد بضع ثوانٍ أو التواصل معنا على واتساب للمساعدة الفورية.';
  } else if (statusCode === 429) {
    msg = 'تم تجاوز الحد المؤقت للطلبات على المساعد الذكي. يرجى المحاولة بعد قليل أو التواصل على واتساب.';
  } else if (statusCode === 401 || statusCode === 403) {
    msg = 'تعذر التحقق من صلاحية مفتاح الذكاء الاصطناعي حالياً. يرجى مراجعة إعدادات الخادم أو التواصل على واتساب.';
  } else if (err instanceof Error && err.message && !err.message.trim().startsWith('{')) {
    msg = err.message;
  }
  const out = new Error(msg) as Error & { statusCode: number };
  out.statusCode = statusCode;
  return out;
}

export async function generateOrvaAssistantReply(params: {
  message: string;
  history: ChatTurnInput[];
  snapshot: StoreKnowledgeSnapshot;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error('مفتاح خدمة الذكاء الاصطناعي (GEMINI_API_KEY) غير مفعّل على الخادم حالياً.');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const systemInstruction = buildStoreSystemInstruction(params.snapshot);

  const contents = [
    ...params.history
      .filter((h) => h.text && h.text.trim())
      .slice(-12)
      .map((h) => ({
        role: h.role === 'model' ? ('model' as const) : ('user' as const),
        parts: [{ text: h.text.trim() }],
      })),
    {
      role: 'user' as const,
      parts: [{ text: params.message.trim() }],
    },
  ];

  const maxAttempts = 2;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: ORVA_AI_MODEL,
        contents,
        config: {
          systemInstruction,
        },
      });

      const reply = (response.text || '').trim();
      if (!reply) {
        throw new Error('لم يتم استلام رد من المساعد الذكي.');
      }
      return reply;
    } catch (err) {
      lastErr = err;
      const code = extractApiStatusCode(err);
      const isTransient = code === 503 || code === 429;
      if (isTransient && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw formatArabicAiError(err, code);
    }
  }

  throw formatArabicAiError(lastErr, extractApiStatusCode(lastErr));
}
