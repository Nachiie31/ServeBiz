export type Supplier = {
  id: string;
  name: string;
  contact: string | null;
};

export type Category = {
  id: string;
  name: string;
};

export type Product = {
  id: string;
  business_id: string;
  code: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  unit: string;
  selling_price: number;
  reorder_level: number;
  is_active: boolean;
};

export type StockRow = {
  product_id: string;
  total_quantity: number;
  nearest_expiry: string | null;
};

export type Batch = {
  id: string;
  product_id: string;
  supplier_id: string | null;
  batch_no: string | null;
  date_received: string;
  expiry_date: string | null;
  quantity_received: number;
  quantity_remaining: number;
  base_price: number;
};

export type Movement = {
  id: string;
  movement_type: string;
  quantity_change: number;
  reason: string | null;
  created_at: string;
};
