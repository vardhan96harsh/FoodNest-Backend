// models/PrepTask.js
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
  // Task identifiers - Make taskNumber NOT required initially
  taskNumber: {
    type: String,
    unique: true
    // Remove 'required: true' - it will be generated in pre-save
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
    enum: ["Morning", "Afternoon", "Evening"],
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
  // Only generate if taskNumber doesn't exist
  if (!this.taskNumber) {
    try {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}${month}${day}`;
      
      // Count documents with today's date prefix
      const count = await mongoose.model("PrepTask").countDocuments({
        taskNumber: { $regex: `^PT-${dateStr}` }
      });
      
      this.taskNumber = `PT-${dateStr}-${String(count + 1).padStart(4, '0')}`;
      console.log(`✅ Generated task number: ${this.taskNumber}`);
    } catch (err) {
      console.error("Error generating task number:", err);
      // Fallback to timestamp-based number
      this.taskNumber = `PT-${Date.now()}`;
    }
  }
  next();
});

export const PrepTask = mongoose.model("PrepTask", prepTaskSchema);