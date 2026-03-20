// models/RawMaterial.js
import mongoose from "mongoose";

const StockMovementSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ["purchase", "consumption", "adjustment", "waste"], 
    required: true 
  },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  previousStock: { type: Number, required: true },
  newStock: { type: Number, required: true },
  
  // Reference to what caused this movement
  referenceType: { 
    type: String, 
    enum: ["food_item", "prep_request", "manual", "purchase_order"] 
  },
  referenceId: { type: mongoose.Schema.Types.ObjectId, refPath: 'referenceModel' },
  referenceModel: { 
    type: String, 
    enum: ["FoodItem", "PrepRequest", "PurchaseOrder"] 
  },
  
  // For consumption tracking
  foodItemId: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem" },
  foodItemName: String,
  quantityProduced: Number,
  
  // For purchase tracking
  supplier: String,
  costPerUnit: Number,
  totalCost: Number,
  invoiceNo: String,
  
  // Who performed the action
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  performedByName: String,
  performedByRole: String,
  
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

const RawMaterialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  category: { 
    type: String, 
    enum: ["Meat", "Vegetables", "Grains", "Spices", "Oils", "Dairy", "Beverages", "Other"],
    default: "Other"
  },
  
  // Current stock
  currentStock: { type: Number, required: true, default: 0, min: 0 },
  unit: { type: String, required: true, trim: true }, // kg, g, liter, ml, piece, packet
  
  // Stock thresholds
  minimumStock: { type: Number, default: 0, min: 0 },
  maximumStock: { type: Number, default: 1000, min: 0 },
  reorderPoint: { type: Number, default: 0, min: 0 },
  
  // Supplier info
  preferredSupplier: { type: String, trim: true },
  alternateSupplier: { type: String, trim: true },
  supplierContact: { type: String, trim: true },
  
  // Cost tracking
  averageCost: { type: Number, default: 0, min: 0 },
  lastPurchaseCost: { type: Number, default: 0, min: 0 },
  lastPurchaseDate: Date,
  lastPurchaseSupplier: String,
  
  // Status
  status: { 
    type: String, 
    enum: ["active", "discontinued", "out_of_stock"], 
    default: "active" 
  },
  
  // Stock movements history
  stockMovements: [StockMovementSchema],
  
  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  
  // For soft delete
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, {
  timestamps: true
});

// Indexes for better query performance
RawMaterialSchema.index({ name: 1 });
RawMaterialSchema.index({ category: 1 });
RawMaterialSchema.index({ status: 1 });
RawMaterialSchema.index({ currentStock: 1 });
RawMaterialSchema.index({ "stockMovements.createdAt": -1 });

// Virtual for stock status
RawMaterialSchema.virtual('stockStatus').get(function() {
  if (this.currentStock <= 0) return 'out_of_stock';
  if (this.currentStock < this.minimumStock) return 'low';
  if (this.currentStock > this.maximumStock) return 'overstock';
  return 'adequate';
});

// Virtual for reorder quantity
RawMaterialSchema.virtual('reorderQuantity').get(function() {
  return Math.max(0, this.maximumStock - this.currentStock);
});

// Method to add stock movement
RawMaterialSchema.methods.addStockMovement = async function(movementData) {
  this.stockMovements.push(movementData);
  return this.save();
};

// Method to consume stock
RawMaterialSchema.methods.consume = async function(quantity, options = {}) {
  const {
    unit,
    referenceType,
    referenceId,
    referenceModel,
    foodItemId,
    foodItemName,
    quantityProduced,
    performedBy,
    performedByName,
    performedByRole,
    notes = ""
  } = options;

  // Validate quantity
  if (quantity <= 0) {
    throw new Error("Consumption quantity must be positive");
  }

  if (this.currentStock < quantity) {
    throw new Error(`Insufficient stock for ${this.name}. Available: ${this.currentStock} ${this.unit}, Required: ${quantity} ${unit}`);
  }

  // Ensure unit matches
  if (unit && unit !== this.unit) {
    throw new Error(`Unit mismatch. Material uses ${this.unit}, but got ${unit}`);
  }

  const previousStock = this.currentStock;
  this.currentStock -= quantity;

  // Create movement record
  const movement = {
    type: "consumption",
    quantity,
    unit: this.unit,
    previousStock,
    newStock: this.currentStock,
    referenceType,
    referenceId,
    referenceModel,
    foodItemId,
    foodItemName,
    quantityProduced,
    performedBy,
    performedByName,
    performedByRole,
    notes,
    createdAt: new Date()
  };

  this.stockMovements.push(movement);
  return this.save();
};

// Method to add stock (purchase)
RawMaterialSchema.methods.addStock = async function(quantity, options = {}) {
  const {
    unit,
    costPerUnit,
    supplier,
    invoiceNo,
    referenceType = "purchase",
    referenceId,
    referenceModel,
    performedBy,
    performedByName,
    performedByRole,
    notes = ""
  } = options;

  // Validate quantity
  if (quantity <= 0) {
    throw new Error("Quantity must be positive");
  }

  // Convert units if needed (simplified - you might want more sophisticated conversion)
  let finalQuantity = quantity;
  if (unit && unit !== this.unit) {
    // Simple conversion - you might want to add a conversion table
    if (unit === 'kg' && this.unit === 'g') finalQuantity = quantity * 1000;
    else if (unit === 'g' && this.unit === 'kg') finalQuantity = quantity / 1000;
    else if (unit === 'liter' && this.unit === 'ml') finalQuantity = quantity * 1000;
    else if (unit === 'ml' && this.unit === 'liter') finalQuantity = quantity / 1000;
    else throw new Error(`Cannot convert from ${unit} to ${this.unit}`);
  }

  const previousStock = this.currentStock;
  this.currentStock += finalQuantity;

  // Update cost tracking
  if (costPerUnit) {
    this.lastPurchaseCost = costPerUnit;
    this.lastPurchaseDate = new Date();
    this.lastPurchaseSupplier = supplier;
    
    // Update average cost
    const totalValue = (this.averageCost * previousStock) + (costPerUnit * finalQuantity);
    this.averageCost = totalValue / this.currentStock;
  }

  // Create movement record
  const movement = {
    type: "purchase",
    quantity: finalQuantity,
    unit: this.unit,
    previousStock,
    newStock: this.currentStock,
    costPerUnit,
    totalCost: costPerUnit ? costPerUnit * finalQuantity : undefined,
    supplier,
    invoiceNo,
    referenceType,
    referenceId,
    referenceModel,
    performedBy,
    performedByName,
    performedByRole,
    notes,
    createdAt: new Date()
  };

  this.stockMovements.push(movement);
  return this.save();
};

export const RawMaterial = mongoose.model("RawMaterial", RawMaterialSchema);