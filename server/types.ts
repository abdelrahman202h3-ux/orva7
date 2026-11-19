export interface ColorOption {
  name: string;
  hex: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  salePrice: number | null;
  showPrice: boolean;
  images: string[];
  sizes: string[];
  colors: ColorOption[];
  stock: number;
  categoryId: string | null;
  collectionIds: string[];
  isPublished: boolean;
  isFeatured: boolean;
  isBestSeller: boolean;
  isNewArrival: boolean;
  showOnHomepage: boolean;
  salesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EffectivePricing {
  basePrice: number;
  finalPrice: number;
  discountPercent: number;
  hasDiscount: boolean;
  appliedOfferTitle: string | null;
}

export interface ProductWithPricing extends Product {
  pricing: EffectivePricing;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  image: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string;
  coverImage: string;
  productIds: string[];
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Offer {
  id: string;
  title: string;
  bannerText: string;
  discountPercent: number;
  startDate: string;
  endDate: string;
  targetType: 'all' | 'products' | 'collections';
  targetIds: string[];
  isActive: boolean;
  createdAt: string;
}

export interface PromoBanner {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaLink: string;
  image: string;
  isVisible: boolean;
}

export interface HomepageSectionConfig {
  id: 'hero' | 'collections' | 'featured' | 'catalog' | 'banners' | 'editorial';
  label: string;
  isVisible: boolean;
  order: number;
}

export interface HomepageConfig {
  heroKicker: string;
  heroTitle: string;
  heroDescription: string;
  heroImage: string;
  heroPrimaryCtaLabel: string;
  heroPrimaryCtaLink: string;
  heroSecondaryCtaLabel: string;
  heroSecondaryCtaLink: string;
  featuredProductIds: string[];
  featuredCategoryIds: string[];
  featuredCollectionIds: string[];
  promoBanners: PromoBanner[];
  sections: HomepageSectionConfig[];
}

export interface SocialLinks {
  instagram: string;
  twitter: string;
  tiktok: string;
  snapchat: string;
}

export interface StoreSettings {
  storeName: string;
  logoUrl: string;
  storeDescription: string;
  announcementText: string;
  announcementVisible: boolean;
  currency: string;
  currencySymbol: string;
  whatsappNumber: string;
  contactEmail: string;
  contactPhone: string;
  deliveryInfo: string;
  returnPolicy: string;
  footerText: string;
  socialLinks: SocialLinks;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'completed'
  | 'cancelled';

export interface OrderItem {
  productId: string;
  productName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  image: string;
}

export type PaymentMethod = 'whatsapp_cod' | 'online_card' | 'online_wallet' | 'stripe';

export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNotes: string;
  items: OrderItem[];
  subtotal: number;
  totalPrice: number;
  currencySymbol: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentReference: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductReview {
  id: string;
  productId: string;
  customerId: string;
  customerName: string;
  orderId: string;
  rating: number;
  title: string;
  comment: string;
  createdAt: string;
}

export interface ReviewSummary {
  averageRating: number;
  reviewCount: number;
}

export interface ProductQuery {
  search?: string;
  categoryId?: string;
  collectionId?: string;
  size?: string;
  color?: string;
  minPrice?: number;
  maxPrice?: number;
  onSaleOnly?: boolean;
  newArrivalOnly?: boolean;
  bestSellerOnly?: boolean;
  featuredOnly?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'best_selling' | 'featured';
}
