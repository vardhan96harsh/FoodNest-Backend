import mongoose from "mongoose";

const prepTaskItemSchema = new mongoose.Schema({
  foodItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FoodItem",
    required: true
  },
  name: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    default: "piece"
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedQuantity: {
    type: Number,
    default: 0
  }
});

const prepTaskHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ["Assigned", "Accepted", "Preparing", "Completed", "Cancelled"],
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ""
  }
});

const prepTaskSchema = new mongoose.Schema({
  // Task identifiers
  taskNumber: {
    type: String,
    unique: true,
    required: true
  },
  
  // Assignment details
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  cook: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: true
  },
  
  // Task items
  items: [prepTaskItemSchema],
  
  // Schedule
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    type: String,
    default: "Morning"
  },
  deadline: {
    type: Date,
    required: true
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ["Assigned", "Accepted", "Preparing", "Completed", "Cancelled"],
    default: "Assigned"
  },
  
  // Timestamps
  assignedAt: {
    type: Date,
    default: Date.now
  },
  acceptedAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  
  // Notes and comments
  supervisorNotes: {
    type: String,
    default: ""
  },
  cookNotes: {
    type: String,
    default: ""
  },
  
  // History
  history: [prepTaskHistorySchema],
  
  // Metadata
  priority: {
    type: String,
    enum: ["High", "Medium", "Low"],
    default: "Medium"
  },
  isUrgent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Generate task number before saving
prepTaskSchema.pre("save", async function(next) {
  if (!this.taskNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const count = await mongoose.model("PrepTask").countDocuments();
    this.taskNumber = `PT-${year}${month}${day}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

export const PrepTask = mongoose.model("PrepTask", prepTaskSchema);