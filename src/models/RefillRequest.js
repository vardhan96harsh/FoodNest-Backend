// models/RefillRequest.js
import mongoose from "mongoose";

const RefillRequestSchema = new mongoose.Schema({
  // Who requested
  rider: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  assignment: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "DailyAssignment" 
  },
  
  // Who approves/processes
  supervisor: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User" 
  },
  cook: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User" 
  },
  refillCoordinator: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User" 
  },

  // What is requested
  items: [
    {
      foodItem: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "FoodItem", 
        required: true 
      },
      name: String,
      quantity: { 
        type: Number, 
        required: true,
        min: 1 
      },
      price: Number,
      unit: String
    }
  ],

  // Request details
  reason: {
    type: String,
    required: true
  },
  urgency: {
    type: String,
    enum: ["Low", "Medium", "High", "Critical"],
    default: "Medium"
  },

  // Status tracking
  status: {
    type: String,
    enum: [
      "Pending",           // Rider requested, waiting for supervisor
      "Approved",           // Supervisor approved, waiting for cook
      "Rejected",          // Supervisor rejected
      "CookPreparing",      // Cook is preparing
      "ReadyForPickup",     // Cook finished, ready for refill coordinator
      "AssignedToRefill",   // Refill coordinator assigned
      "OutForDelivery",     // Refill coordinator on the way
      "Delivered"           // Refill coordinator delivered to rider
    ],
    default: "Pending"
  },

  // Timestamps for each step
  requestedAt: {
    type: Date,
    default: Date.now
  },
  supervisorActionAt: Date,
  cookStartedAt: Date,
  cookCompletedAt: Date,
  refillAssignedAt: Date,
  refillStartedAt: Date,
  deliveredAt: Date,

  // Notes/comments
  supervisorNotes: String,
  cookNotes: String,
  refillNotes: String,

  // Location tracking
  riderLocation: {
    lat: Number,
    lng: Number,
    address: String
  },
  
  // For tracking history
  history: [
    {
      status: String,
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      updatedAt: Date,
      notes: String
    }
  ]

}, { timestamps: true });

// Index for faster queries
RefillRequestSchema.index({ rider: 1, status: 1 });
RefillRequestSchema.index({ supervisor: 1, status: 1 });
RefillRequestSchema.index({ cook: 1, status: 1 });
RefillRequestSchema.index({ refillCoordinator: 1, status: 1 });

export default mongoose.model("RefillRequest", RefillRequestSchema);