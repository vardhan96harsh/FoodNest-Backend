import mongoose from "mongoose";

// Location Schema for sales
const LocationSchema = new mongoose.Schema({
  lat: {
    type: Number,
    required: true
  },
  lng: {
    type: Number,
    required: true
  }
}, { _id: false });

const SalesTransactionSchema = new mongoose.Schema({
  assignment: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "DailyAssignment", 
    required: true,
    index: true
  },

  rider: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true
  },

  foodItem: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "FoodItem", 
    required: true,
    index: true
  },

  stopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DailyAssignment.stops",
    default: null,
    index: true
  },

  stopName: {
    type: String,
    default: null
  },

  quantity: { 
    type: Number, 
    required: true,
    min: 1
  },

  price: { 
    type: Number, 
    required: true,
    min: 0
  },

  total: { 
    type: Number, 
    required: true,
    min: 0
  },

  // Location where sale was made
  location: {
    type: LocationSchema,
    default: null
  },

  // Timestamp of the sale
  soldAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },

  // Additional metadata
  notes: {
    type: String,
    default: null
  },

  // Payment method (if tracking)
  paymentMethod: {
    type: String,
    enum: ["cash", "card", "upi", "other"],
    default: "cash"
  }

}, { 
  timestamps: true 
});

// Compound indexes for efficient queries
SalesTransactionSchema.index({ assignment: 1, soldAt: -1 });
SalesTransactionSchema.index({ rider: 1, soldAt: -1 });
SalesTransactionSchema.index({ stopId: 1, soldAt: -1 });
SalesTransactionSchema.index({ foodItem: 1, soldAt: -1 });

// Static method to get sales summary for an assignment
SalesTransactionSchema.statics.getAssignmentSummary = async function(assignmentId) {
  const summary = await this.aggregate([
    { $match: { assignment: mongoose.Types.ObjectId(assignmentId) } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$total" },
        totalItems: { $sum: "$quantity" },
        totalTransactions: { $sum: 1 },
        avgTransactionValue: { $avg: "$total" }
      }
    }
  ]);
  
  return summary[0] || {
    totalRevenue: 0,
    totalItems: 0,
    totalTransactions: 0,
    avgTransactionValue: 0
  };
};

// Static method to get sales by stop
SalesTransactionSchema.statics.getSalesByStop = async function(assignmentId) {
  return this.aggregate([
    { $match: { assignment: mongoose.Types.ObjectId(assignmentId) } },
    {
      $group: {
        _id: "$stopId",
        stopName: { $first: "$stopName" },
        totalRevenue: { $sum: "$total" },
        totalItems: { $sum: "$quantity" },
        transactions: { $sum: 1 }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ]);
};

// Static method to get sales by hour (for time-based analysis)
SalesTransactionSchema.statics.getSalesByHour = async function(assignmentId) {
  return this.aggregate([
    { $match: { assignment: mongoose.Types.ObjectId(assignmentId) } },
    {
      $group: {
        _id: { $hour: "$soldAt" },
        totalRevenue: { $sum: "$total" },
        totalItems: { $sum: "$quantity" },
        transactions: { $sum: 1 }
      }
    },
    { $sort: { "_id": 1 } }
  ]);
};

// Method to get formatted sale details
SalesTransactionSchema.methods.getDetails = async function() {
  const populated = await this.populate('foodItem', 'name category')
    .populate('rider', 'name email')
    .execPopulate();
  
  return {
    id: populated._id,
    foodItem: populated.foodItem,
    quantity: populated.quantity,
    price: populated.price,
    total: populated.total,
    location: populated.location,
    stopId: populated.stopId,
    stopName: populated.stopName,
    soldAt: populated.soldAt,
    rider: populated.rider
  };
};

export const SalesTransaction = mongoose.model("SalesTransaction", SalesTransactionSchema);
export default SalesTransaction;