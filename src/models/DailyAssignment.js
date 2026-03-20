import mongoose from "mongoose";

const StopTrackingSchema = new mongoose.Schema(
{
  stopName: String,
  arrivedAt: Date,
  completedAt: Date,
  durationMinutes: Number,
  status: {
    type: String,
    enum: ["pending", "in-progress", "completed"],
    default: "pending"
  }
},
{ _id: false }
);

const InventorySchema = new mongoose.Schema(
{
  foodItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FoodItem"
  },
  name: String,
  quantityAssigned: Number,
  quantitySold: {
    type: Number,
    default: 0
  },
  quantityRemaining: Number,
  price: { type: Number, default: 0 } // Add price for easier calculations
},
{ _id: false }
);

const DailyAssignmentSchema = new mongoose.Schema(
{
  date: {
    type: Date,
    required: true,
    index: true // Add index for better query performance
  },

  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: true
  },

  route: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Route"
  },

  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true // Add index for rider queries
  },

  refillCoordinator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vehicle",
    index: true // Add index for vehicle queries
  },

  battery: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Battery",
    index: true // Add index for battery queries
  },

  startTime: Date,

  endTime: Date,

  status: {
    type: String,
    enum: ["pending", "active", "completed", "cancelled"], // Add more status options
    default: "pending" // Change default to "pending" instead of "active"
  },

  inventory: [InventorySchema],

  stops: [StopTrackingSchema],

  currentLocation: {
    lat: Number,
    lng: Number,
    updatedAt: Date
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  // Add fields for better tracking
  totalSales: {
    type: Number,
    default: 0
  },

  totalItemsSold: {
    type: Number,
    default: 0
  },

  // Track if inventory has been returned/unlocked
  inventoryReturned: {
    type: Boolean,
    default: false
  },

  // Track when the assignment was closed/completed
  closedAt: Date,
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }
},
{
  timestamps: true,
  // Add compound indexes for common queries
  indexes: [
    {
      fields: { date: 1, team: 1, status: 1 }
    },
    {
      fields: { rider: 1, date: 1, status: 1 }
    },
    {
      fields: { vehicle: 1, date: 1, status: 1 }
    },
    {
      fields: { battery: 1, date: 1, status: 1 }
    }
  ]
}
);

// Add pre-save middleware to calculate totals
DailyAssignmentSchema.pre('save', function(next) {
  if (this.inventory && this.inventory.length > 0) {
    this.totalItemsSold = this.inventory.reduce((sum, item) => sum + (item.quantitySold || 0), 0);
    this.totalSales = this.inventory.reduce((sum, item) => sum + ((item.quantitySold || 0) * (item.price || 0)), 0);
  }
  next();
});

// Add static method to check resource availability
DailyAssignmentSchema.statics.checkResourceAvailability = async function(
  teamId,
  vehicleId,
  batteryId,
  riderId,
  date = new Date()
) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  // Find any active assignments for these resources on the given date
  const existingAssignments = await this.find({
    team: teamId,
    date: { $gte: startOfDay, $lt: endOfDay },
    status: { $in: ["pending", "active"] },
    $or: [
      { vehicle: vehicleId },
      { battery: batteryId },
      { rider: riderId }
    ]
  }).lean();

  const conflicts = {
    vehicle: false,
    battery: false,
    rider: false
  };

  existingAssignments.forEach(assignment => {
    if (assignment.vehicle && assignment.vehicle.toString() === vehicleId?.toString()) {
      conflicts.vehicle = true;
    }
    if (assignment.battery && assignment.battery.toString() === batteryId?.toString()) {
      conflicts.battery = true;
    }
    if (assignment.rider && assignment.rider.toString() === riderId?.toString()) {
      conflicts.rider = true;
    }
  });

  return {
    available: !conflicts.vehicle && !conflicts.battery && !conflicts.rider,
    conflicts
  };
};

// Add method to close assignment and free resources
DailyAssignmentSchema.methods.closeAssignment = async function(userId) {
  this.status = "completed";
  this.endTime = new Date();
  this.closedAt = new Date();
  this.closedBy = userId;
  this.inventoryReturned = true;
  
  // Calculate final totals
  if (this.inventory && this.inventory.length > 0) {
    this.totalItemsSold = this.inventory.reduce((sum, item) => sum + (item.quantitySold || 0), 0);
    this.totalSales = this.inventory.reduce((sum, item) => sum + ((item.quantitySold || 0) * (item.price || 0)), 0);
  }
  
  return this.save();
};

// Add method to cancel assignment
DailyAssignmentSchema.methods.cancelAssignment = async function(userId) {
  this.status = "cancelled";
  this.endTime = new Date();
  this.closedAt = new Date();
  this.closedBy = userId;
  this.inventoryReturned = true;
  return this.save();
};

export const DailyAssignment = mongoose.model("DailyAssignment", DailyAssignmentSchema);
export default DailyAssignment;