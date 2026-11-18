'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  DollarSign,
  Factory,
  Flame,
  LayoutDashboard,
  Menu,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShoppingBag,
  Trash2,
  TrendingUp,
  UtensilsCrossed,
  X,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ============================================================================
// TIPOS DE DOMINIO
// ============================================================================
type CurrencyCode = 'USD' | 'VES';
type IngredientCategory = 'masa' | 'relleno' | 'adicional';
type PresentationUnit = 'g' | 'kg' | 'pza' | 'l';
type PaymentMethod = 'USD_CASH' | 'ZELLE' | 'PAGO_MOVIL' | 'VES_CASH' | 'MIXED';
type NavTab = 'dashboard' | 'calculadora' | 'inventario' | 'ventas' | 'configuracion';

interface AppSettings {
  exchange_rate_ves_usd: number;
  indirect_labor_usd: number;
  indirect_utilities_usd: number;
  indirect_packaging_usd: number;
  default_margin_pct: number;
  critical_stock_grams: number;
  critical_stock_units: number;
  bcv_auto_sync: boolean;
  bcv_sync_time_1: string;
  bcv_sync_time_2: string;
  bcv_last_sync_at: string;
  bcv_last_sync_source: string;
}

interface Ingredient {
  id: string;
  name: string;
  category: IngredientCategory;
  presentation_label: string;
  presentation_unit: PresentationUnit;
  presentation_grams: number;
  price_amount: number;
  price_currency: CurrencyCode;
  stock_grams: number;
  min_purchase_grams: number;
  supplier_notes: string;
}

interface RecipeItem {
  ingredient_id: string;
  section: IngredientCategory;
  quantity_grams: number;
  is_to_taste?: boolean;
}

interface Recipe {
  id: string;
  name: string;
  description: string;
  is_base: boolean;
  dough_weight_grams: number;
  custom_margin_pct?: number;
  custom_sale_price_usd?: number | null;
  custom_labor_usd?: number;
  custom_utilities_usd?: number;
  custom_packaging_usd?: number;
  items: RecipeItem[];
}

interface ProductionBatch {
  id: string;
  recipe_id: string;
  recipe_name: string;
  batch_name: string;
  quantity_loaves: number;
  total_cost_usd: number;
  projected_revenue_usd: number;
  exchange_rate_snapshot: number;
  created_at: string;
}

interface SaleRecord {
  id: string;
  recipe_id: string;
  recipe_name: string;
  customer_name: string;
  quantity_loaves: number;
  unit_price_usd: number;
  total_usd: number;
  total_ves: number;
  payment_method: PaymentMethod;
  sold_at: string;
}

interface IngredientLineCost {
  ingredient_id: string;
  ingredient_name: string;
  section: IngredientCategory;
  quantity_grams: number;
  is_to_taste: boolean;
  unit_price_usd: number;
  cost_usd: number;
  cost_ves: number;
}

interface RecipeCostBreakdown {
  lines: IngredientLineCost[];
  total_weight_grams: number;
  dough_cost_usd: number;
  filling_cost_usd: number;
  additional_cost_usd: number;
  direct_cost_usd: number;
  indirect_labor_usd: number;
  indirect_utilities_usd: number;
  indirect_packaging_usd: number;
  indirect_cost_usd: number;
  total_cost_usd: number;
  total_cost_ves: number;
  margin_pct: number;
  sale_price_usd: number;
  sale_price_ves: number;
  profit_per_loaf_usd: number;
  profit_per_loaf_ves: number;
}

// ============================================================================
// UTILIDADES MONETARIAS Y MOTOR DE COSTOS
// ============================================================================
const STORAGE_KEY = 'pan_de_jamon_pos_state_v2';
const BCV_API_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';

function getNextBcvSyncLabel(time1: string, time2: string): string {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const slots = [time1, time2].filter(Boolean).sort();
  if (slots.length === 0) return 'Sin horario';
  for (const slot of slots) {
    if (slot > hhmm) return `Hoy ${slot}`;
  }
  return `Mañana ${slots[0]}`;
}

function roundMoney(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function toUsd(amount: number, currency: CurrencyCode, rate: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (currency === 'USD') return amount;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return amount / rate;
}

function toVes(amountUsd: number, rate: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return amountUsd * rate;
}

function formatUsd(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

function formatVes(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
  return `Bs. ${formatted}`;
}

function calculateRecipeCost(
  items: RecipeItem[],
  ingredients: Ingredient[],
  settings: AppSettings,
  overrides?: {
    margin_pct?: number;
    sale_price_usd?: number | null;
    labor_usd?: number;
    utilities_usd?: number;
    packaging_usd?: number;
  }
): RecipeCostBreakdown {
  const rate = settings.exchange_rate_ves_usd > 0 ? settings.exchange_rate_ves_usd : 40;
  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

  let doughCostUsd = 0;
  let fillingCostUsd = 0;
  let additionalCostUsd = 0;
  let totalWeightGrams = 0;
  const lines: IngredientLineCost[] = [];

  for (const item of items) {
    const ing = ingredientMap.get(item.ingredient_id);
    if (!ing) continue;

    const unitPriceUsd = toUsd(ing.price_amount, ing.price_currency, rate);
    const costUsd =
      ing.presentation_grams > 0 && item.quantity_grams > 0
        ? (item.quantity_grams / ing.presentation_grams) * unitPriceUsd
        : 0;

    totalWeightGrams += item.quantity_grams;
    if (item.section === 'masa') doughCostUsd += costUsd;
    else if (item.section === 'relleno') fillingCostUsd += costUsd;
    else additionalCostUsd += costUsd;

    lines.push({
      ingredient_id: ing.id,
      ingredient_name: ing.name,
      section: item.section,
      quantity_grams: item.quantity_grams,
      is_to_taste: Boolean(item.is_to_taste),
      unit_price_usd: roundMoney(unitPriceUsd, 4),
      cost_usd: roundMoney(costUsd, 4),
      cost_ves: roundMoney(toVes(costUsd, rate), 2),
    });
  }

  const directCostUsd = doughCostUsd + fillingCostUsd + additionalCostUsd;
  const laborUsd = overrides?.labor_usd ?? settings.indirect_labor_usd;
  const utilitiesUsd = overrides?.utilities_usd ?? settings.indirect_utilities_usd;
  const packagingUsd = overrides?.packaging_usd ?? settings.indirect_packaging_usd;
  const indirectCostUsd = laborUsd + utilitiesUsd + packagingUsd;

  const totalCostUsd = directCostUsd + indirectCostUsd;
  const hasCustomPrice =
    overrides?.sale_price_usd != null &&
    Number.isFinite(overrides.sale_price_usd) &&
    overrides.sale_price_usd > 0;
  let marginPct = Math.min(Math.max(overrides?.margin_pct ?? settings.default_margin_pct, 0), 99);
  let salePriceUsd = totalCostUsd / (1 - marginPct / 100);
  if (hasCustomPrice) {
    salePriceUsd = overrides!.sale_price_usd!;
    marginPct = roundMoney(((salePriceUsd - totalCostUsd) / salePriceUsd) * 100, 1);
  }
  const profitPerLoafUsd = salePriceUsd - totalCostUsd;

  return {
    lines,
    total_weight_grams: roundMoney(totalWeightGrams, 1),
    dough_cost_usd: roundMoney(doughCostUsd, 4),
    filling_cost_usd: roundMoney(fillingCostUsd, 4),
    additional_cost_usd: roundMoney(additionalCostUsd, 4),
    direct_cost_usd: roundMoney(directCostUsd, 4),
    indirect_labor_usd: roundMoney(laborUsd, 4),
    indirect_utilities_usd: roundMoney(utilitiesUsd, 4),
    indirect_packaging_usd: roundMoney(packagingUsd, 4),
    indirect_cost_usd: roundMoney(indirectCostUsd, 4),
    total_cost_usd: roundMoney(totalCostUsd, 2),
    total_cost_ves: roundMoney(toVes(totalCostUsd, rate), 2),
    margin_pct: marginPct,
    sale_price_usd: roundMoney(salePriceUsd, 2),
    sale_price_ves: roundMoney(toVes(salePriceUsd, rate), 2),
    profit_per_loaf_usd: roundMoney(profitPerLoafUsd, 2),
    profit_per_loaf_ves: roundMoney(toVes(profitPerLoafUsd, rate), 2),
  };
}

function evaluateIngredientStock(
  ingredient: Ingredient,
  baseRecipeItems: RecipeItem[],
  settings: AppSettings
) {
  const recipeItem = baseRecipeItems.find((i) => i.ingredient_id === ingredient.id);
  const requiredGrams = recipeItem?.quantity_grams ?? 0;
  const unitsRemaining =
    ingredient.presentation_grams > 0
      ? ingredient.stock_grams / ingredient.presentation_grams
      : 0;

  const isCritical =
    ingredient.presentation_unit === 'pza'
      ? unitsRemaining < settings.critical_stock_units
      : ingredient.stock_grams < settings.critical_stock_grams;

  const hasEnoughForBase =
    requiredGrams === 0 ? ingredient.stock_grams > 0 : ingredient.stock_grams >= requiredGrams;

  const maxLoavesPossible =
    requiredGrams > 0 ? Math.floor(ingredient.stock_grams / requiredGrams) : null;

  return {
    isCritical,
    hasEnoughForBase,
    requiredGrams,
    maxLoavesPossible,
    unitsRemaining: roundMoney(unitsRemaining, 2),
  };
}

// ============================================================================
// DATOS INICIALES (SEED DEL USUARIO + EXCEL + RECETARIO)
// ============================================================================
const INITIAL_SETTINGS: AppSettings = {
  exchange_rate_ves_usd: 916.65,
  indirect_labor_usd: 1.0,
  indirect_utilities_usd: 1.0,
  indirect_packaging_usd: 0.08,
  default_margin_pct: 19,
  critical_stock_grams: 2000,
  critical_stock_units: 5,
  bcv_auto_sync: true,
  bcv_sync_time_1: '09:00',
  bcv_sync_time_2: '16:30',
  bcv_last_sync_at: '18/11/2026 09:00',
  bcv_last_sync_source: 'BCV Oficial (18 Nov 2026)',
};

const INITIAL_INGREDIENTS: Ingredient[] = [
  { id: 'ing-jamon', name: 'Jamón ahumado Bigcerdy', category: 'relleno', presentation_label: '1 kg (pza 5 kg)', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 5.99, price_currency: 'USD', stock_grams: 5000, min_purchase_grams: 5000, supplier_notes: 'Precio por kg (pieza 5 kg ≈ $29,95)' },
  { id: 'ing-tocineta', name: 'Tocineta', category: 'relleno', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 9.49, price_currency: 'USD', stock_grams: 3000, min_purchase_grams: 3000, supplier_notes: 'Compra mínima: 3 kg' },
  { id: 'ing-harina', name: 'Harina de trigo', category: 'masa', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 1000, price_currency: 'VES', stock_grams: 5000, min_purchase_grams: 1000, supplier_notes: 'Precio en Bs' },
  { id: 'ing-pasas', name: 'Uvas pasas', category: 'relleno', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 5.0, price_currency: 'USD', stock_grams: 1500, min_purchase_grams: 1000, supplier_notes: '' },
  { id: 'ing-aceitunas', name: 'Aceitunas', category: 'relleno', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 7.0, price_currency: 'USD', stock_grams: 1500, min_purchase_grams: 1000, supplier_notes: '' },
  { id: 'ing-papelon', name: 'Papelón', category: 'adicional', presentation_label: '0.5 kg', presentation_unit: 'kg', presentation_grams: 500, price_amount: 2.0, price_currency: 'USD', stock_grams: 1000, min_purchase_grams: 500, supplier_notes: 'Al gusto (5g base)' },
  { id: 'ing-levadura', name: 'Levadura instantánea', category: 'masa', presentation_label: '0.5 kg', presentation_unit: 'kg', presentation_grams: 500, price_amount: 5.0, price_currency: 'USD', stock_grams: 500, min_purchase_grams: 500, supplier_notes: '' },
  { id: 'ing-azucar', name: 'Azúcar', category: 'masa', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 1000, price_currency: 'VES', stock_grams: 3000, min_purchase_grams: 1000, supplier_notes: 'Precio en Bs' },
  { id: 'ing-mantequilla', name: 'Mantequilla', category: 'masa', presentation_label: '0.5 kg', presentation_unit: 'kg', presentation_grams: 500, price_amount: 1000, price_currency: 'VES', stock_grams: 1500, min_purchase_grams: 500, supplier_notes: 'Precio en Bs' },
  { id: 'ing-agua', name: 'Agua', category: 'masa', presentation_label: '1 L (1000g)', presentation_unit: 'l', presentation_grams: 1000, price_amount: 0.25, price_currency: 'USD', stock_grams: 10000, min_purchase_grams: 0, supplier_notes: 'Referencia Excel' },
  { id: 'ing-sal', name: 'Sal', category: 'masa', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 1.5, price_currency: 'USD', stock_grams: 2000, min_purchase_grams: 0, supplier_notes: 'Referencia Excel' },
  { id: 'ing-tapara', name: 'Tápara', category: 'relleno', presentation_label: '1 kg', presentation_unit: 'kg', presentation_grams: 1000, price_amount: 10.0, price_currency: 'USD', stock_grams: 2000, min_purchase_grams: 0, supplier_notes: 'Referencia Excel' },
  { id: 'ing-pimienta', name: 'Pimienta molida', category: 'adicional', presentation_label: '0.1 kg', presentation_unit: 'g', presentation_grams: 100, price_amount: 2.0, price_currency: 'USD', stock_grams: 200, min_purchase_grams: 0, supplier_notes: 'Al gusto (2g base)' },
];

const INITIAL_BASE_RECIPE: Recipe = {
  id: 'rec-base-500g',
  name: 'Pan de Jamón Clásico (500g Masa)',
  description: 'Receta base tradicional navideña.',
  is_base: true,
  dough_weight_grams: 500,
  items: [
    { ingredient_id: 'ing-harina', section: 'masa', quantity_grams: 294 },
    { ingredient_id: 'ing-agua', section: 'masa', quantity_grams: 136 },
    { ingredient_id: 'ing-azucar', section: 'masa', quantity_grams: 30 },
    { ingredient_id: 'ing-mantequilla', section: 'masa', quantity_grams: 30 },
    { ingredient_id: 'ing-levadura', section: 'masa', quantity_grams: 4 },
    { ingredient_id: 'ing-sal', section: 'masa', quantity_grams: 4 },
    { ingredient_id: 'ing-jamon', section: 'relleno', quantity_grams: 250 },
    { ingredient_id: 'ing-tapara', section: 'relleno', quantity_grams: 100 },
    { ingredient_id: 'ing-pasas', section: 'relleno', quantity_grams: 50 },
    { ingredient_id: 'ing-aceitunas', section: 'relleno', quantity_grams: 50 },
    { ingredient_id: 'ing-tocineta', section: 'relleno', quantity_grams: 50 },
    { ingredient_id: 'ing-papelon', section: 'adicional', quantity_grams: 5, is_to_taste: true },
    { ingredient_id: 'ing-pimienta', section: 'adicional', quantity_grams: 2, is_to_taste: true },
  ],
};

function loadSavedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistState(state: {
  settings: AppSettings;
  ingredients: Ingredient[];
  recipes: Recipe[];
  activeRecipeId: string;
  currentBatchLoaves: number;
  batches: ProductionBatch[];
  sales: SaleRecord[];
}) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Entorno sin almacenamiento persistente disponible
  }
}

interface PosState {
  settings: AppSettings;
  ingredients: Ingredient[];
  recipes: Recipe[];
  activeRecipeId: string;
  currentBatchLoaves: number;
  batches: ProductionBatch[];
  sales: SaleRecord[];
  bcvSyncStatus: 'idle' | 'loading' | 'ok' | 'error';
  bcvSyncMessage: string | null;
  hydrateLocal: () => void;
  syncBcvRate: () => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setActiveRecipe: (id: string) => void;
  setCurrentBatchLoaves: (loaves: number) => void;
  addIngredient: (ing: Omit<Ingredient, 'id'>) => void;
  updateIngredient: (id: string, partial: Partial<Ingredient>) => void;
  deleteIngredient: (id: string) => void;
  saveRecipeVariation: (rec: Omit<Recipe, 'id' | 'is_base'>) => void;
  updateRecipeSalePrice: (recipeId: string, salePriceUsd: number | null) => void;
  produceBatch: (recipeId: string, batchName: string, quantityLoaves: number) => { ok: boolean; message: string };
  registerSale: (input: {
    recipeId: string;
    customerName: string;
    quantityLoaves: number;
    paymentMethod: PaymentMethod;
    customUnitPriceUsd?: number;
  }) => void;
}

const usePosStore = create<PosState>((set, get) => {
  const saveCurrent = () => {
    const s = get();
    persistState({
      settings: s.settings,
      ingredients: s.ingredients,
      recipes: s.recipes,
      activeRecipeId: s.activeRecipeId,
      currentBatchLoaves: s.currentBatchLoaves,
      batches: s.batches,
      sales: s.sales,
    });
  };

  return {
    settings: INITIAL_SETTINGS,
    ingredients: INITIAL_INGREDIENTS,
    recipes: [INITIAL_BASE_RECIPE],
    activeRecipeId: INITIAL_BASE_RECIPE.id,
    currentBatchLoaves: 20,
    batches: [],
    sales: [],
    bcvSyncStatus: 'idle',
    bcvSyncMessage: null,

    syncBcvRate: async () => {
      set({ bcvSyncStatus: 'loading', bcvSyncMessage: null });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(BCV_API_URL, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const rate = Number(data?.promedio);
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error('Respuesta sin tasa válida');
        }
        const now = new Date();
        const stamp = `${now.toLocaleDateString('es-VE')} ${now.toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        set((s) => ({
          settings: {
            ...s.settings,
            exchange_rate_ves_usd: roundMoney(rate, 2),
            bcv_last_sync_at: stamp,
            bcv_last_sync_source: 'BCV en vivo (DolarAPI)',
          },
          bcvSyncStatus: 'ok',
          bcvSyncMessage: `Tasa BCV actualizada a ${formatVes(roundMoney(rate, 2))}.`,
        }));
        saveCurrent();
      } catch {
        set({
          bcvSyncStatus: 'error',
          bcvSyncMessage: 'No se pudo consultar la API BCV ahora; se mantiene la tasa vigente.',
        });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    hydrateLocal: () => {
      const saved = loadSavedState();
      if (saved && Array.isArray(saved.ingredients) && Array.isArray(saved.recipes)) {
        set({
          settings: { ...INITIAL_SETTINGS, ...saved.settings },
          ingredients: saved.ingredients,
          recipes: saved.recipes.length > 0 ? saved.recipes : [INITIAL_BASE_RECIPE],
          activeRecipeId: saved.activeRecipeId || INITIAL_BASE_RECIPE.id,
          currentBatchLoaves: saved.currentBatchLoaves || 20,
          batches: Array.isArray(saved.batches) ? saved.batches : [],
          sales: Array.isArray(saved.sales) ? saved.sales : [],
        });
      }
    },

    updateSettings: (partial) => {
      set((s) => ({ settings: { ...s.settings, ...partial } }));
      saveCurrent();
    },

    setActiveRecipe: (id) => {
      set({ activeRecipeId: id });
      saveCurrent();
    },

    setCurrentBatchLoaves: (loaves) => {
      set({ currentBatchLoaves: Math.max(1, Math.floor(loaves || 1)) });
      saveCurrent();
    },

    addIngredient: (ing) => {
      const id = `ing-${Date.now().toString(36)}`;
      set((s) => ({ ingredients: [...s.ingredients, { ...ing, id }] }));
      saveCurrent();
    },

    updateIngredient: (id, partial) => {
      set((s) => ({
        ingredients: s.ingredients.map((i) => (i.id === id ? { ...i, ...partial } : i)),
      }));
      saveCurrent();
    },

    deleteIngredient: (id) => {
      set((s) => ({
        ingredients: s.ingredients.filter((i) => i.id !== id),
      }));
      saveCurrent();
    },

    saveRecipeVariation: (rec) => {
      const id = `rec-${Date.now().toString(36)}`;
      const newRecipe: Recipe = { ...rec, id, is_base: false };
      set((s) => ({
        recipes: [...s.recipes, newRecipe],
        activeRecipeId: id,
      }));
      saveCurrent();
    },

    updateRecipeSalePrice: (recipeId, salePriceUsd) => {
      set((s) => ({
        recipes: s.recipes.map((r) =>
          r.id === recipeId
            ? {
                ...r,
                custom_sale_price_usd:
                  salePriceUsd != null && salePriceUsd > 0 ? roundMoney(salePriceUsd, 2) : null,
              }
            : r
        ),
      }));
      saveCurrent();
    },

    produceBatch: (recipeId, batchName, quantityLoaves) => {
      const { recipes, ingredients, settings } = get();
      const recipe = recipes.find((r) => r.id === recipeId);
      if (!recipe) return { ok: false, message: 'Receta no encontrada.' };

      const qty = Math.max(1, Math.floor(quantityLoaves));
      const missing: string[] = [];

      for (const item of recipe.items) {
        if (item.quantity_grams <= 0) continue;
        const ing = ingredients.find((i) => i.id === item.ingredient_id);
        const needed = item.quantity_grams * qty;
        if (ing && ing.stock_grams < needed) {
          missing.push(`${ing.name} (faltan ${roundMoney(needed - ing.stock_grams, 0)}g)`);
        }
      }

      if (missing.length > 0) {
        return {
          ok: false,
          message: `Stock insuficiente para ${qty} panes: ${missing.join(', ')}.`,
        };
      }

      const breakdown = calculateRecipeCost(recipe.items, ingredients, settings, {
        margin_pct: recipe.custom_margin_pct,
        sale_price_usd: recipe.custom_sale_price_usd,
        labor_usd: recipe.custom_labor_usd,
        utilities_usd: recipe.custom_utilities_usd,
        packaging_usd: recipe.custom_packaging_usd,
      });

      const nextIngredients = ingredients.map((ing) => {
        const used = recipe.items.find((i) => i.ingredient_id === ing.id);
        if (!used || used.quantity_grams <= 0) return ing;
        return { ...ing, stock_grams: roundMoney(ing.stock_grams - used.quantity_grams * qty, 2) };
      });

      const batch: ProductionBatch = {
        id: `batch-${Date.now().toString(36)}`,
        recipe_id: recipe.id,
        recipe_name: recipe.name,
        batch_name: batchName.trim() || 'Lote Navideño',
        quantity_loaves: qty,
        total_cost_usd: roundMoney(breakdown.total_cost_usd * qty, 2),
        projected_revenue_usd: roundMoney(breakdown.sale_price_usd * qty, 2),
        exchange_rate_snapshot: settings.exchange_rate_ves_usd,
        created_at: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }),
      };

      set((s) => ({
        ingredients: nextIngredients,
        batches: [batch, ...s.batches],
      }));
      saveCurrent();
      return {
        ok: true,
        message: `Lote "${batch.batch_name}" (${qty} panes) horneado. Inventario descontado.`,
      };
    },

    registerSale: ({ recipeId, customerName, quantityLoaves, paymentMethod, customUnitPriceUsd }) => {
      const { recipes, ingredients, settings } = get();
      const recipe = recipes.find((r) => r.id === recipeId) ?? recipes[0];
      const qty = Math.max(1, Math.floor(quantityLoaves));
      const breakdown = calculateRecipeCost(recipe.items, ingredients, settings, {
        margin_pct: recipe.custom_margin_pct,
        sale_price_usd: recipe.custom_sale_price_usd,
        labor_usd: recipe.custom_labor_usd,
        utilities_usd: recipe.custom_utilities_usd,
        packaging_usd: recipe.custom_packaging_usd,
      });

      const unitPriceUsd =
        customUnitPriceUsd != null && Number.isFinite(customUnitPriceUsd) && customUnitPriceUsd > 0
          ? roundMoney(customUnitPriceUsd, 2)
          : breakdown.sale_price_usd;
      const totalUsd = roundMoney(unitPriceUsd * qty, 2);
      const totalVes = roundMoney(toVes(totalUsd, settings.exchange_rate_ves_usd), 2);

      const sale: SaleRecord = {
        id: `sale-${Date.now().toString(36)}`,
        recipe_id: recipe.id,
        recipe_name: recipe.name,
        customer_name: customerName.trim() || 'Cliente mostrador',
        quantity_loaves: qty,
        unit_price_usd: unitPriceUsd,
        total_usd: totalUsd,
        total_ves: totalVes,
        payment_method: paymentMethod,
        sold_at: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }),
      };

      set((s) => ({ sales: [sale, ...s.sales] }));
      saveCurrent();
    },
  };
});

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  USD_CASH: 'Efectivo USD',
  ZELLE: 'Zelle',
  PAGO_MOVIL: 'Pago Móvil',
  VES_CASH: 'Bolívares Efectivo',
  MIXED: 'Mixto (USD + Bs)',
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function App() {
  const store = usePosStore();
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const lastTriggeredSlotRef = React.useRef<string>('');

  useEffect(() => {
    store.hydrateLocal();
  }, []);

  // Programador automático BCV: verifica cada 60s si toca una de las 2 actualizaciones diarias
  useEffect(() => {
    if (!store.settings.bcv_auto_sync) return;

    const checkSchedule = () => {
      const now = new Date();
      const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const targets = [store.settings.bcv_sync_time_1, store.settings.bcv_sync_time_2];

      if (targets.includes(hhmm)) {
        const slotKey = `${dateKey}_${hhmm}`;
        if (lastTriggeredSlotRef.current !== slotKey) {
          lastTriggeredSlotRef.current = slotKey;
          store.syncBcvRate();
        }
      }
    };

    const intervalId = setInterval(checkSchedule, 60000);
    return () => clearInterval(intervalId);
  }, [
    store.settings.bcv_auto_sync,
    store.settings.bcv_sync_time_1,
    store.settings.bcv_sync_time_2,
  ]);

  const navItems: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'calculadora', label: 'Calculadora', icon: Calculator },
    { id: 'inventario', label: 'Inventario', icon: Package },
    { id: 'ventas', label: 'Producción y POS', icon: ShoppingBag },
    { id: 'configuracion', label: 'Configuración', icon: Settings },
  ];

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  return (
    <div className="flex min-h-screen w-full bg-zinc-50 text-zinc-900 font-sans">
      {/* Overlay móvil */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-zinc-950 text-zinc-100 transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white shadow-sm">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">Pan de Jamón POS</h1>
              <p className="text-xs text-zinc-400">Gestión Navideña</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 lg:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSelectTab(id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-zinc-800 p-4 space-y-2">
          <button
            type="button"
            onClick={() => handleSelectTab('configuracion')}
            className="w-full rounded-lg bg-zinc-900 p-3 text-left transition hover:bg-zinc-800"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-400">Tasa BCV actual</p>
              {store.settings.bcv_auto_sync && (
                <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                  Auto 2×/día
                </span>
              )}
            </div>
            <p className="mt-0.5 text-base font-bold text-amber-400">
              {formatVes(store.settings.exchange_rate_ves_usd)} / $1
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              Próx.: {getNextBcvSyncLabel(store.settings.bcv_sync_time_1, store.settings.bcv_sync_time_2)}
            </p>
          </button>
          <button
            type="button"
            onClick={() => store.syncBcvRate()}
            disabled={store.bcvSyncStatus === 'loading'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/70 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${store.bcvSyncStatus === 'loading' ? 'animate-spin' : ''}`} />
            {store.bcvSyncStatus === 'loading' ? 'Sincronizando...' : 'Sincronizar BCV ahora'}
          </button>
        </div>
      </aside>

      {/* Contenido principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior móvil */}
        <header className="flex items-center justify-between border-b bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-lg border p-2 text-zinc-700 hover:bg-zinc-100"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold text-zinc-900">Pan de Jamón POS</span>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {formatVes(store.settings.exchange_rate_ves_usd)}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {activeTab === 'dashboard' && <DashboardView onNavigate={handleSelectTab} />}
            {activeTab === 'calculadora' && <CalculadoraView />}
            {activeTab === 'inventario' && <InventarioView />}
            {activeTab === 'ventas' && <VentasProduccionView />}
            {activeTab === 'configuracion' && <ConfiguracionView />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// VISTA 1: DASHBOARD
// ============================================================================
function DashboardView({ onNavigate }: { onNavigate: (tab: NavTab) => void }) {
  const {
    settings,
    ingredients,
    recipes,
    activeRecipeId,
    currentBatchLoaves,
    setCurrentBatchLoaves,
    setActiveRecipe,
    sales,
    batches,
  } = usePosStore();

  const activeRecipe = useMemo(
    () => recipes.find((r) => r.id === activeRecipeId) ?? recipes[0],
    [recipes, activeRecipeId]
  );

  const baseRecipe = useMemo(
    () => recipes.find((r) => r.is_base) ?? recipes[0],
    [recipes]
  );

  const breakdown = useMemo(
    () =>
      calculateRecipeCost(activeRecipe.items, ingredients, settings, {
        margin_pct: activeRecipe.custom_margin_pct,
        sale_price_usd: activeRecipe.custom_sale_price_usd,
        labor_usd: activeRecipe.custom_labor_usd,
        utilities_usd: activeRecipe.custom_utilities_usd,
        packaging_usd: activeRecipe.custom_packaging_usd,
      }),
    [activeRecipe, ingredients, settings]
  );

  const totalProductionUsd = roundMoney(breakdown.total_cost_usd * currentBatchLoaves, 2);
  const projectedRevenueUsd = roundMoney(breakdown.sale_price_usd * currentBatchLoaves, 2);
  const netProfitUsd = roundMoney(projectedRevenueUsd - totalProductionUsd, 2);

  const criticalItems = useMemo(
    () =>
      ingredients
        .map((ing) => ({
          ingredient: ing,
          stock: evaluateIngredientStock(ing, baseRecipe.items, settings),
        }))
        .filter((x) => x.stock.isCritical),
    [ingredients, baseRecipe, settings]
  );

  const chartData = [
    {
      name: 'Costo Directo',
      usd: roundMoney(breakdown.direct_cost_usd * currentBatchLoaves, 2),
      color: '#f59e0b',
    },
    {
      name: 'Costo Indirecto',
      usd: roundMoney(breakdown.indirect_cost_usd * currentBatchLoaves, 2),
      color: '#64748b',
    },
    {
      name: 'Costo Total',
      usd: totalProductionUsd,
      color: '#ef4444',
    },
    {
      name: 'Ganancia Neta',
      usd: netProfitUsd,
      color: '#10b981',
    },
  ];

  const totalSalesUsd = useMemo(
    () => roundMoney(sales.reduce((acc, s) => acc + s.total_usd, 0), 2),
    [sales]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Dashboard de Producción
          </h2>
          <p className="text-sm text-zinc-500">
            Simulación financiera del lote y alertas de inventario en tiempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={activeRecipe.id}
            onChange={(e) => setActiveRecipe(e.target.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium shadow-sm"
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 shadow-sm">
            <label htmlFor="dash-lote" className="text-xs font-medium text-zinc-600">
              Lote (panes):
            </label>
            <input
              id="dash-lote"
              type="number"
              min={1}
              value={currentBatchLoaves}
              onChange={(e) => setCurrentBatchLoaves(Number(e.target.value) || 1)}
              className="w-16 rounded border border-zinc-200 px-2 py-1 text-center text-sm font-bold"
            />
          </div>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
            <span>Costo Producción ({currentBatchLoaves} panes)</span>
            <Factory className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{formatUsd(totalProductionUsd)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {formatVes(toVes(totalProductionUsd, settings.exchange_rate_ves_usd))}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
            <span>Ingresos Proyectados</span>
            <DollarSign className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{formatUsd(projectedRevenueUsd)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {formatVes(toVes(projectedRevenueUsd, settings.exchange_rate_ves_usd))}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-emerald-800">
            <span>Ganancia Neta ({breakdown.margin_pct}%)</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{formatUsd(netProfitUsd)}</p>
          <p className="mt-0.5 text-xs text-emerald-700/80">
            {formatVes(toVes(netProfitUsd, settings.exchange_rate_ves_usd))}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
            <span>Tasa BCV {settings.bcv_auto_sync ? '(Auto 2×/día)' : '(Manual)'}</span>
            <button
              type="button"
              onClick={() => usePosStore.getState().syncBcvRate()}
              title="Sincronizar tasa BCV ahora"
              className="rounded p-1 text-amber-600 hover:bg-amber-50"
            >
              <RefreshCw className={`h-4 w-4 ${usePosStore.getState().bcvSyncStatus === 'loading' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">
            {formatVes(settings.exchange_rate_ves_usd)}
          </p>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-zinc-500">
              {settings.bcv_sync_time_1} · {settings.bcv_sync_time_2}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('configuracion')}
              className="font-medium text-amber-600 hover:underline"
            >
              Configurar →
            </button>
          </div>
        </div>
      </div>

      {/* Gráfico + Stock Crítico */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">
                Costos vs Ganancias del Lote (USD)
              </h3>
              <p className="text-xs text-zinc-500">
                Precio unitario: {formatUsd(breakdown.sale_price_usd)} ({formatVes(breakdown.sale_price_ves)})
              </p>
            </div>
            {sales.length > 0 && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Ventas reales: {formatUsd(totalSalesUsd)} ({batches.length} lotes)
              </span>
            )}
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [
                    `${formatUsd(value)} (${formatVes(toVes(value, settings.exchange_rate_ves_usd))})`,
                    'Monto',
                  ]}
                />
                <Bar dataKey="usd" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Stock Crítico
            </h3>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
              {criticalItems.length}
            </span>
          </div>

          {criticalItems.length === 0 ? (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              Todos los ingredientes están por encima del mínimo operativo.
            </p>
          ) : (
            <ul className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
              {criticalItems.map(({ ingredient, stock }) => (
                <li
                  key={ingredient.id}
                  className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/70 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {ingredient.name}
                    </p>
                    <p className="text-xs text-zinc-600">
                      {ingredient.presentation_unit === 'pza'
                        ? `${stock.unitsRemaining} pzas`
                        : `${(ingredient.stock_grams / 1000).toFixed(2)} kg`}
                    </p>
                  </div>
                  <span className="ml-2 shrink-0 rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-700">
                    {stock.maxLoavesPossible !== null
                      ? `~${stock.maxLoavesPossible} panes`
                      : 'Bajo'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => onNavigate('inventario')}
            className="mt-4 w-full rounded-lg border border-amber-200 bg-amber-50 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
          >
            Reponer en Inventario →
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VISTA 2: CALCULADORA DE PRECIOS
// ============================================================================
function CalculadoraView() {
  const {
    settings,
    ingredients,
    recipes,
    activeRecipeId,
    setActiveRecipe,
    saveRecipeVariation,
    updateRecipeSalePrice,
  } = usePosStore();

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === activeRecipeId) ?? recipes[0],
    [recipes, activeRecipeId]
  );

  const [items, setItems] = useState<RecipeItem[]>(selectedRecipe.items);
  const [marginPct, setMarginPct] = useState<number>(
    selectedRecipe.custom_margin_pct ?? settings.default_margin_pct
  );
  const [customSalePrice, setCustomSalePrice] = useState<number | null>(
    selectedRecipe.custom_sale_price_usd ?? null
  );
  const [laborUsd, setLaborUsd] = useState<number>(
    selectedRecipe.custom_labor_usd ?? settings.indirect_labor_usd
  );
  const [utilitiesUsd, setUtilitiesUsd] = useState<number>(
    selectedRecipe.custom_utilities_usd ?? settings.indirect_utilities_usd
  );
  const [packagingUsd, setPackagingUsd] = useState<number>(
    selectedRecipe.custom_packaging_usd ?? settings.indirect_packaging_usd
  );

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setItems(selectedRecipe.items);
    setMarginPct(selectedRecipe.custom_margin_pct ?? settings.default_margin_pct);
    setCustomSalePrice(selectedRecipe.custom_sale_price_usd ?? null);
    setLaborUsd(selectedRecipe.custom_labor_usd ?? settings.indirect_labor_usd);
    setUtilitiesUsd(selectedRecipe.custom_utilities_usd ?? settings.indirect_utilities_usd);
    setPackagingUsd(selectedRecipe.custom_packaging_usd ?? settings.indirect_packaging_usd);
  }, [selectedRecipe.id, settings]);

  const breakdown = useMemo(
    () =>
      calculateRecipeCost(items, ingredients, settings, {
        margin_pct: marginPct,
        sale_price_usd: customSalePrice,
        labor_usd: laborUsd,
        utilities_usd: utilitiesUsd,
        packaging_usd: packagingUsd,
      }),
    [items, ingredients, settings, marginPct, customSalePrice, laborUsd, utilitiesUsd, packagingUsd]
  );

  const handleQtyChange = (ingredientId: string, grams: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.ingredient_id === ingredientId
          ? { ...item, quantity_grams: Math.max(0, grams) }
          : item
      )
    );
  };

  const handleReset = () => {
    setItems(selectedRecipe.items);
    setMarginPct(settings.default_margin_pct);
    setCustomSalePrice(null);
    updateRecipeSalePrice(selectedRecipe.id, null);
    setLaborUsd(settings.indirect_labor_usd);
    setUtilitiesUsd(settings.indirect_utilities_usd);
    setPackagingUsd(settings.indirect_packaging_usd);
  };

  const handleDirectPriceChange = (val: number) => {
    if (!Number.isFinite(val) || val <= 0) {
      setCustomSalePrice(null);
      updateRecipeSalePrice(selectedRecipe.id, null);
      return;
    }
    setCustomSalePrice(val);
    updateRecipeSalePrice(selectedRecipe.id, val);
  };

  const handleSaveRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    saveRecipeVariation({
      name: newName.trim(),
      description: newDesc.trim(),
      dough_weight_grams: 500,
      custom_margin_pct: breakdown.margin_pct,
      custom_sale_price_usd: customSalePrice,
      custom_labor_usd: laborUsd,
      custom_utilities_usd: utilitiesUsd,
      custom_packaging_usd: packagingUsd,
      items,
    });
    setNewName('');
    setNewDesc('');
    setSaveModalOpen(false);
    setToast('Variación guardada y seleccionada.');
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Calculadora de Precios
          </h2>
          <p className="text-sm text-zinc-500">
            Fórmula: Precio de Venta = Costo Total / (1 - Margen). Edita gramos para probar variaciones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedRecipe.id}
            onChange={(e) => setActiveRecipe(e.target.value)}
            className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium"
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            <RotateCcw className="h-4 w-4" />
            Restablecer
          </button>

          <button
            type="button"
            onClick={() => setSaveModalOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-amber-700"
          >
            <Save className="h-4 w-4" />
            Guardar Receta
          </button>
        </div>
      </div>

      {toast && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {toast}
        </div>
      )}

      {/* Tarjetas destacadas */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="calc-sale-price"
              className="text-xs font-semibold uppercase tracking-wide text-amber-800"
            >
              Precio de Venta por Pan (Editable)
            </label>
            {customSalePrice !== null && (
              <button
                type="button"
                onClick={() => handleDirectPriceChange(0)}
                className="text-[11px] font-semibold text-amber-700 underline hover:text-amber-950"
              >
                Usar margen
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-2xl font-extrabold text-amber-950">$</span>
            <input
              id="calc-sale-price"
              type="number"
              step="0.25"
              min="0.50"
              value={customSalePrice ?? breakdown.sale_price_usd}
              onChange={(e) => handleDirectPriceChange(Number(e.target.value))}
              className="w-32 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-2xl font-extrabold text-amber-950 focus:border-amber-600 focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-base font-bold text-amber-800">
            {formatVes(breakdown.sale_price_ves)}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Ganancia por Pan ({breakdown.margin_pct}%)
          </p>
          <p className="mt-1.5 text-3xl font-extrabold text-emerald-700">
            {formatUsd(breakdown.profit_per_loaf_usd)}
          </p>
          <p className="mt-1 text-base font-bold text-emerald-800">
            {formatVes(breakdown.profit_per_loaf_ves)}
          </p>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Costo Total por Pan ({breakdown.total_weight_grams}g)
          </p>
          <p className="mt-1.5 text-2xl font-bold text-zinc-900">
            {formatUsd(breakdown.total_cost_usd)}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Directo: <strong>{formatUsd(breakdown.direct_cost_usd)}</strong> · Indirecto:{' '}
            <strong>{formatUsd(breakdown.indirect_cost_usd)}</strong>
          </p>
        </div>
      </div>

      {/* Sliders + Tabla dinámica */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-fit space-y-5 rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-zinc-900">
            Margen y Costos Indirectos
          </h3>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="calc-margin" className="font-medium text-zinc-700">
                Margen de Ganancia
              </label>
              <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
                {breakdown.margin_pct}%
              </span>
            </div>
            <input
              id="calc-margin"
              type="range"
              min={5}
              max={75}
              step={1}
              value={Math.min(75, Math.max(5, Math.round(breakdown.margin_pct)))}
              onChange={(e) => {
                setCustomSalePrice(null);
                updateRecipeSalePrice(selectedRecipe.id, null);
                setMarginPct(Number(e.target.value));
              }}
              className="w-full accent-amber-600"
            />
            <p className="text-xs text-zinc-500">
              Divisor aplicado: {(1 - marginPct / 100).toFixed(2)}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="calc-labor" className="block text-xs font-medium text-zinc-600">
                Sueldos por pan (USD)
              </label>
              <input
                id="calc-labor"
                type="number"
                step="0.05"
                min={0}
                value={laborUsd}
                onChange={(e) => setLaborUsd(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="calc-util" className="block text-xs font-medium text-zinc-600">
                Servicios: Luz, Gas, Espacio (USD)
              </label>
              <input
                id="calc-util"
                type="number"
                step="0.05"
                min={0}
                value={utilitiesUsd}
                onChange={(e) => setUtilitiesUsd(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="calc-pack" className="block text-xs font-medium text-zinc-600">
                Empaque y Publicidad (USD)
              </label>
              <input
                id="calc-pack"
                type="number"
                step="0.01"
                min={0}
                value={packagingUsd}
                onChange={(e) => setPackagingUsd(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5 rounded-lg bg-zinc-100 p-3 text-xs text-zinc-700">
            <div className="flex justify-between">
              <span>Valor de la Masa:</span>
              <span className="font-semibold">{formatUsd(breakdown.dough_cost_usd)}</span>
            </div>
            <div className="flex justify-between">
              <span>Valor del Relleno:</span>
              <span className="font-semibold">{formatUsd(breakdown.filling_cost_usd)}</span>
            </div>
            <div className="flex justify-between">
              <span>Adicionales:</span>
              <span className="font-semibold">{formatUsd(breakdown.additional_cost_usd)}</span>
            </div>
            <div className="flex justify-between border-t border-zinc-300 pt-1.5 font-semibold text-zinc-900">
              <span>Total Indirectos:</span>
              <span>{formatUsd(breakdown.indirect_cost_usd)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-base font-semibold text-zinc-900">
            Desglose Dinámico de Ingredientes (1 Pan)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-zinc-500">
                  <th className="pb-2.5 pr-3">Ingrediente</th>
                  <th className="pb-2.5 pr-3">Sección</th>
                  <th className="pb-2.5 pr-3">Receta (g)</th>
                  <th className="pb-2.5 pr-3 text-right">Costo USD</th>
                  <th className="pb-2.5 text-right">Costo Bs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {breakdown.lines.map((line) => (
                  <tr key={line.ingredient_id} className="hover:bg-zinc-50">
                    <td className="py-2.5 pr-3 font-medium text-zinc-900">
                      {line.ingredient_name}
                      {line.is_to_taste && (
                        <span className="ml-1 text-xs text-zinc-400">(al gusto)</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs capitalize text-zinc-700">
                        {line.section}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={line.quantity_grams}
                        onChange={(e) =>
                          handleQtyChange(line.ingredient_id, Number(e.target.value) || 0)
                        }
                        className="w-20 rounded border border-zinc-300 px-2 py-1 text-right text-sm"
                      />
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-sm">
                      {formatUsd(line.cost_usd)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-sm text-zinc-600">
                      {formatVes(line.cost_ves)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Guardar Receta */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-zinc-900">Guardar variación de receta</h3>
            <form onSubmit={handleSaveRecipe} className="mt-4 space-y-4">
              <div>
                <label htmlFor="var-name" className="block text-xs font-medium text-zinc-700">
                  Nombre de la variación
                </label>
                <input
                  id="var-name"
                  required
                  placeholder="Ej. Pan de Jamón sin Tocineta"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="var-desc" className="block text-xs font-medium text-zinc-700">
                  Descripción (opcional)
                </label>
                <input
                  id="var-desc"
                  placeholder="Notas sobre relleno o margen"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSaveModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Guardar variación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VISTA 3: INVENTARIO (CRUD)
// ============================================================================
const EMPTY_INGREDIENT: Omit<Ingredient, 'id'> = {
  name: '',
  category: 'relleno',
  presentation_label: '1 kg',
  presentation_unit: 'kg',
  presentation_grams: 1000,
  price_amount: 0,
  price_currency: 'USD',
  stock_grams: 0,
  min_purchase_grams: 0,
  supplier_notes: '',
};

function InventarioView() {
  const { settings, ingredients, recipes, addIngredient, updateIngredient, deleteIngredient } =
    usePosStore();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | IngredientCategory>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Ingredient, 'id'>>(EMPTY_INGREDIENT);
  const [confirmDelete, setConfirmDelete] = useState<Ingredient | null>(null);

  const baseRecipe = useMemo(() => recipes.find((r) => r.is_base) ?? recipes[0], [recipes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients.filter((i) => {
      const matchCat = catFilter === 'all' || i.category === catFilter;
      const matchQ = !q || i.name.toLowerCase().includes(q) || i.supplier_notes.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [ingredients, search, catFilter]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_INGREDIENT);
    setFormOpen(true);
  };

  const openEdit = (ing: Ingredient) => {
    setEditingId(ing.id);
    const { id: _id, ...rest } = ing;
    setForm(rest);
    setFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.presentation_grams <= 0) return;
    if (editingId) {
      updateIngredient(editingId, { ...form, name: form.name.trim() });
    } else {
      addIngredient({ ...form, name: form.name.trim() });
    }
    setFormOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Inventario de Ingredientes
          </h2>
          <p className="text-sm text-zinc-500">
            Soporte nativo en USD y Bolívares con indicador de suficiencia para la receta base.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-amber-700"
        >
          <Plus className="h-4 w-4" />
          Agregar Ingrediente
        </button>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'masa', 'relleno', 'adicional'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCatFilter(cat)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                  catFilter === cat
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                {cat === 'all' ? 'Todos' : cat}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar ingrediente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-zinc-500">
                <th className="pb-2.5 pr-3">Ingrediente</th>
                <th className="pb-2.5 pr-3">Presentación</th>
                <th className="pb-2.5 pr-3 text-right">Precio Original</th>
                <th className="pb-2.5 pr-3 text-right">Precio USD</th>
                <th className="pb-2.5 pr-3 text-right">Stock</th>
                <th className="pb-2.5 pr-3">Receta Base</th>
                <th className="pb-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((ing) => {
                const priceUsd = toUsd(
                  ing.price_amount,
                  ing.price_currency,
                  settings.exchange_rate_ves_usd
                );
                const stockEval = evaluateIngredientStock(ing, baseRecipe.items, settings);

                return (
                  <tr key={ing.id} className="hover:bg-zinc-50">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-zinc-900">{ing.name}</div>
                      <div className="text-xs text-zinc-500">
                        <span className="capitalize">{ing.category}</span>
                        {ing.supplier_notes && ` · ${ing.supplier_notes}`}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div>{ing.presentation_label}</div>
                      <div className="text-xs text-zinc-500">
                        {ing.presentation_grams.toLocaleString('es-VE')} g
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">
                      {ing.price_currency === 'USD'
                        ? formatUsd(ing.price_amount)
                        : formatVes(ing.price_amount)}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono font-semibold">
                      {formatUsd(priceUsd)}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <div className="font-medium">
                        {ing.presentation_unit === 'pza'
                          ? `${stockEval.unitsRemaining} pzas`
                          : `${(ing.stock_grams / 1000).toFixed(2)} kg`}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {ing.stock_grams.toLocaleString('es-VE')} g
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      {stockEval.hasEnoughForBase ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {stockEval.maxLoavesPossible !== null
                            ? `${stockEval.maxLoavesPossible} panes`
                            : 'OK'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          <XCircle className="h-3.5 w-3.5" />
                          Falta ({stockEval.requiredGrams}g)
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(ing)}
                          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-200"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(ing)}
                          className="rounded p-1.5 text-red-500 hover:bg-red-50"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Crear / Editar */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-zinc-900">
              {editingId ? 'Editar Ingrediente' : 'Agregar Ingrediente'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700">Nombre</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Categoría</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as IngredientCategory })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="masa">Masa</option>
                  <option value="relleno">Relleno</option>
                  <option value="adicional">Adicional</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Unidad</label>
                <select
                  value={form.presentation_unit}
                  onChange={(e) =>
                    setForm({ ...form, presentation_unit: e.target.value as PresentationUnit })
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="kg">Kilogramo (kg)</option>
                  <option value="g">Gramo (g)</option>
                  <option value="pza">Pieza (pza)</option>
                  <option value="l">Litro (L)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Etiqueta</label>
                <input
                  value={form.presentation_label}
                  onChange={(e) => setForm({ ...form, presentation_label: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Presentación (g)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.presentation_grams}
                  onChange={(e) =>
                    setForm({ ...form, presentation_grams: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Precio</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  required
                  value={form.price_amount}
                  onChange={(e) => setForm({ ...form, price_amount: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Moneda</label>
                <select
                  value={form.price_currency}
                  onChange={(e) => setForm({ ...form, price_currency: e.target.value as CurrencyCode })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="USD">Dólares (USD)</option>
                  <option value="VES">Bolívares (Bs)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Stock actual (g)</label>
                <input
                  type="number"
                  min={0}
                  value={form.stock_grams}
                  onChange={(e) => setForm({ ...form, stock_grams: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700">Compra mínima (g)</label>
                <input
                  type="number"
                  min={0}
                  value={form.min_purchase_grams}
                  onChange={(e) =>
                    setForm({ ...form, min_purchase_grams: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700">Notas del proveedor</label>
                <input
                  value={form.supplier_notes}
                  onChange={(e) => setForm({ ...form, supplier_notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  {editingId ? 'Guardar cambios' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Eliminación */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-zinc-900">Eliminar ingrediente</h3>
            <p className="mt-2 text-sm text-zinc-600">
              ¿Seguro que deseas eliminar <strong>{confirmDelete.name}</strong> del inventario?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteIngredient(confirmDelete.id);
                  setConfirmDelete(null);
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VISTA 4: PRODUCCIÓN DE LOTES Y VENTAS POS
// ============================================================================
function VentasProduccionView() {
  const { settings, ingredients, recipes, batches, sales, produceBatch, registerSale } =
    usePosStore();

  const [batchRecipeId, setBatchRecipeId] = useState(recipes[0]?.id ?? '');
  const [batchName, setBatchName] = useState('Lote Navideño #1');
  const [batchQty, setBatchQty] = useState(5);
  const [batchMsg, setBatchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [saleRecipeId, setSaleRecipeId] = useState(recipes[0]?.id ?? '');
  const [customerName, setCustomerName] = useState('');
  const [saleQty, setSaleQty] = useState(1);
  const [saleUnitPriceOverride, setSaleUnitPriceOverride] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PAGO_MOVIL');
  const [saleMsg, setSaleMsg] = useState<string | null>(null);

  const selectedSaleRecipe = useMemo(
    () => recipes.find((r) => r.id === saleRecipeId) ?? recipes[0],
    [recipes, saleRecipeId]
  );

  const saleBreakdown = useMemo(
    () =>
      calculateRecipeCost(selectedSaleRecipe.items, ingredients, settings, {
        margin_pct: selectedSaleRecipe.custom_margin_pct,
        sale_price_usd: selectedSaleRecipe.custom_sale_price_usd,
        labor_usd: selectedSaleRecipe.custom_labor_usd,
        utilities_usd: selectedSaleRecipe.custom_utilities_usd,
        packaging_usd: selectedSaleRecipe.custom_packaging_usd,
      }),
    [selectedSaleRecipe, ingredients, settings]
  );

  useEffect(() => {
    setSaleUnitPriceOverride(null);
  }, [saleRecipeId]);

  const effectiveUnitPriceUsd =
    saleUnitPriceOverride !== null && saleUnitPriceOverride > 0
      ? saleUnitPriceOverride
      : saleBreakdown.sale_price_usd;
  const totalSaleUsd = roundMoney(effectiveUnitPriceUsd * saleQty, 2);
  const totalSaleVes = roundMoney(toVes(totalSaleUsd, settings.exchange_rate_ves_usd), 2);

  const handleProduce = (e: React.FormEvent) => {
    e.preventDefault();
    const res = produceBatch(batchRecipeId, batchName, batchQty);
    setBatchMsg({ ok: res.ok, text: res.message });
  };

  const handleSale = (e: React.FormEvent) => {
    e.preventDefault();
    registerSale({
      recipeId: saleRecipeId,
      customerName,
      quantityLoaves: saleQty,
      paymentMethod,
      customUnitPriceUsd: effectiveUnitPriceUsd,
    });
    setCustomerName('');
    setSaleQty(1);
    setSaleUnitPriceOverride(null);
    setSaleMsg('Venta registrada en caja.');
    setTimeout(() => setSaleMsg(null), 2500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
          Producción de Lotes y Ventas POS
        </h2>
        <p className="text-sm text-zinc-500">
          Hornea lotes con descuento automático de stock y cobra en USD o Bolívares.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Hornear Lote */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <Flame className="h-4 w-4 text-amber-600" />
            Hornear Lote (Descuento Automático)
          </h3>

          <form onSubmit={handleProduce} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700">Receta</label>
              <select
                value={batchRecipeId}
                onChange={(e) => setBatchRecipeId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700">Nombre del lote</label>
                <input
                  required
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">Cantidad (panes)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={batchQty}
                  onChange={(e) => setBatchQty(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {batchMsg && (
              <div
                className={`flex items-start gap-2 rounded-lg p-3 text-xs font-medium ${
                  batchMsg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                }`}
              >
                {batchMsg.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{batchMsg.text}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Hornear Lote y Descontar Inventario
            </button>
          </form>
        </div>

        {/* Caja Rápida POS */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <ShoppingBag className="h-4 w-4 text-emerald-600" />
            Registrar Venta POS
          </h3>

          <form onSubmit={handleSale} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700">Receta</label>
                <select
                  value={saleRecipeId}
                  onChange={(e) => setSaleRecipeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">Método de pago</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  {Object.entries(PAYMENT_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">Cliente (opcional)</label>
                <input
                  placeholder="Ej. María Pérez"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">Precio unitario (USD)</label>
                <input
                  type="number"
                  step="0.25"
                  min="0.50"
                  required
                  value={effectiveUnitPriceUsd}
                  onChange={(e) => setSaleUnitPriceOverride(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-700">Cantidad (panes)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={saleQty}
                  onChange={(e) => setSaleQty(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
              <span className="text-sm font-medium text-emerald-900">Total a cobrar:</span>
              <div className="text-right">
                <div className="text-lg font-extrabold text-emerald-700">
                  {formatUsd(totalSaleUsd)}
                </div>
                <div className="text-xs font-semibold text-emerald-800">
                  {formatVes(totalSaleVes)}
                </div>
              </div>
            </div>

            {saleMsg && <p className="text-xs font-semibold text-emerald-700">{saleMsg}</p>}

            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Registrar Venta
            </button>
          </form>
        </div>
      </div>

      {/* Historiales */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-zinc-900">
            Ventas Recientes ({sales.length})
          </h3>
          {sales.length === 0 ? (
            <p className="text-sm text-zinc-500">Aún no has registrado ventas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-zinc-500">
                    <th className="pb-2">Cliente</th>
                    <th className="pb-2">Método</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2">
                        <div className="font-medium">{s.customer_name}</div>
                        <div className="text-xs text-zinc-500">
                          {s.quantity_loaves} pan(es) · {s.sold_at}
                        </div>
                      </td>
                      <td className="py-2">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
                          {PAYMENT_LABELS[s.payment_method]}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono">
                        <div className="font-semibold">{formatUsd(s.total_usd)}</div>
                        <div className="text-xs text-zinc-500">{formatVes(s.total_ves)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-zinc-900">
            Lotes Horneados ({batches.length})
          </h3>
          {batches.length === 0 ? (
            <p className="text-sm text-zinc-500">Aún no has horneado ningún lote.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-zinc-500">
                    <th className="pb-2">Lote</th>
                    <th className="pb-2 text-right">Costo</th>
                    <th className="pb-2 text-right">Proyectado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2">
                        <div className="font-medium">{b.batch_name}</div>
                        <div className="text-xs text-zinc-500">
                          {b.quantity_loaves} panes · {b.created_at}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono">{formatUsd(b.total_cost_usd)}</td>
                      <td className="py-2 text-right font-mono font-semibold text-emerald-700">
                        {formatUsd(b.projected_revenue_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VISTA 5: CONFIGURACIÓN
// ============================================================================
function ConfiguracionView() {
  const { settings, updateSettings, syncBcvRate, bcvSyncStatus, bcvSyncMessage } = usePosStore();

  const [rate, setRate] = useState(settings.exchange_rate_ves_usd);
  const [autoSync, setAutoSync] = useState(settings.bcv_auto_sync);
  const [syncTime1, setSyncTime1] = useState(settings.bcv_sync_time_1);
  const [syncTime2, setSyncTime2] = useState(settings.bcv_sync_time_2);
  const [labor, setLabor] = useState(settings.indirect_labor_usd);
  const [utilities, setUtilities] = useState(settings.indirect_utilities_usd);
  const [packaging, setPackaging] = useState(settings.indirect_packaging_usd);
  const [margin, setMargin] = useState(settings.default_margin_pct);
  const [critGrams, setCritGrams] = useState(settings.critical_stock_grams);
  const [critUnits, setCritUnits] = useState(settings.critical_stock_units);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRate(settings.exchange_rate_ves_usd);
  }, [settings.exchange_rate_ves_usd]);

  const totalIndirect = labor + utilities + packaging;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (rate <= 0) return;
    updateSettings({
      exchange_rate_ves_usd: rate,
      bcv_auto_sync: autoSync,
      bcv_sync_time_1: syncTime1 || '09:00',
      bcv_sync_time_2: syncTime2 || '16:30',
      indirect_labor_usd: Math.max(0, labor),
      indirect_utilities_usd: Math.max(0, utilities),
      indirect_packaging_usd: Math.max(0, packaging),
      default_margin_pct: Math.min(Math.max(margin, 0), 99),
      critical_stock_grams: Math.max(0, critGrams),
      critical_stock_units: Math.max(0, critUnits),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <form onSubmit={handleSave} className="max-w-3xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Configuración General
          </h2>
          <p className="text-sm text-zinc-500">
            Actualiza la tasa de cambio y costos indirectos fijos por pan.
          </p>
        </div>

        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-amber-700"
        >
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? 'Guardado' : 'Guardar Cambios'}
        </button>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">
              Doble Moneda y Sincronización BCV (2×/día)
            </h3>
            <p className="text-xs text-zinc-500">
              Última actualización: {settings.bcv_last_sync_at} · {settings.bcv_last_sync_source}
            </p>
          </div>
          <button
            type="button"
            onClick={() => syncBcvRate()}
            disabled={bcvSyncStatus === 'loading'}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${bcvSyncStatus === 'loading' ? 'animate-spin' : ''}`} />
            {bcvSyncStatus === 'loading' ? 'Consultando BCV...' : 'Sincronizar BCV ahora'}
          </button>
        </div>

        {bcvSyncMessage && (
          <div
            className={`rounded-lg px-3 py-2 text-xs font-medium ${
              bcvSyncStatus === 'ok'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-amber-50 text-amber-900'
            }`}
          >
            {bcvSyncMessage}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cfg-rate" className="block text-xs font-medium text-zinc-700">
              Tasa de Cambio BCV (Bs por $1 USD)
            </label>
            <input
              id="cfg-rate"
              type="number"
              step="0.01"
              min={0.01}
              required
              value={rate}
              onChange={(e) => setRate(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-bold"
            />
          </div>
          <div className="flex flex-col justify-center rounded-lg bg-zinc-100 p-3 text-sm">
            <span className="text-xs text-zinc-500">Equivalencia de referencia</span>
            <span className="font-semibold text-zinc-900">
              $1.00 = {formatVes(rate)} · Bs. 1.000 = {formatUsd(rate > 0 ? 1000 / rate : 0)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <span className="block text-sm font-semibold text-zinc-900">
                Actualización automática BCV (2 veces al día)
              </span>
              <span className="block text-xs text-zinc-500">
                Consulta automáticamente la tasa oficial en los dos horarios configurados. Próxima: {getNextBcvSyncLabel(syncTime1, syncTime2)}.
              </span>
            </div>
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
              className="h-4 w-4 accent-amber-600"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cfg-t1" className="block text-xs font-medium text-zinc-700">
                Horario 1 (Mañana)
              </label>
              <input
                id="cfg-t1"
                type="time"
                value={syncTime1}
                disabled={!autoSync}
                onChange={(e) => setSyncTime1(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="cfg-t2" className="block text-xs font-medium text-zinc-700">
                Horario 2 (Tarde / Cierre BCV)
              </label>
              <input
                id="cfg-t2"
                type="time"
                value={syncTime2}
                disabled={!autoSync}
                onChange={(e) => setSyncTime2(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-base font-semibold text-zinc-900">
          Costos Indirectos Fijos por Pan (USD)
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-zinc-700">Sueldos ($)</label>
            <input
              type="number"
              step="0.05"
              min={0}
              value={labor}
              onChange={(e) => setLabor(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700">
              Servicios: Luz, Gas, Espacio ($)
            </label>
            <input
              type="number"
              step="0.05"
              min={0}
              value={utilities}
              onChange={(e) => setUtilities(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700">
              Empaque y Publicidad ($)
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={packaging}
              onChange={(e) => setPackaging(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-amber-900">Total Costos Indirectos por Pan:</span>
          <span className="font-bold text-amber-950">
            {formatUsd(totalIndirect)} ({formatVes(toVes(totalIndirect, rate))})
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-base font-semibold text-zinc-900">
          Margen y Alertas de Inventario
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-zinc-700">Margen por defecto (%)</label>
            <input
              type="number"
              min={0}
              max={99}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700">Stock crítico (g)</label>
            <input
              type="number"
              min={0}
              value={critGrams}
              onChange={(e) => setCritGrams(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700">Stock crítico (pzas)</label>
            <input
              type="number"
              min={0}
              value={critUnits}
              onChange={(e) => setCritUnits(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>
    </form>
  );
}
