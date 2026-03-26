import mongoose from "mongoose";

// Enhanced Stop Sales Item Schema
const StopSalesItemSchema = new mongoose.Schema({
  foodItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FoodItem"
  },
  name: String,
  quantity: {
    type: Number,
    default: 0
  },
  price: {
    type: Number,
    default: 0
  }
}, { _id: false });

// Enhanced Stop Sales Schema
const StopSalesSchema = new mongoose.Schema({
  items: [StopSalesItemSchema],
  totalRevenue: {
    type: Number,
    default: 0
  },
  totalItems: {
    type: Number,
    default: 0
  }
}, { _id: false });

// Location History Item Schema
const LocationHistorySchema = new mongoose.Schema({
  lat: {
    type: Number,
    required: true
  },
  lng: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Enhanced Stop Tracking Schema with Sales Support
const StopTrackingSchema = new mongoose.Schema({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    default: () => new mongoose.Types.ObjectId(),
    auto: true
  },
  stopName: {
    type: String,
    required: true
  },
  address: {
    type: String,
    default: ""
  },
  arrivedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  durationMinutes: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ["pending", "in-progress", "completed", "skipped"],
    default: "pending"
  },
  sales: {
    type: StopSalesSchema,
    default: () => ({ items: [], totalRevenue: 0, totalItems: 0 })
  }
});

// Inventory Schema - ADDED source field for permanent items support
const InventorySchema = new mongoose.Schema({
  foodItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FoodItem",
    required: true
  },
  name: {
    type: String,
    required: true
  },
  quantityAssigned: {
    type: Number,
    required: true,
    min: 0
  },
  quantitySold: {
    type: Number,
    default: 0,
    min: 0
  },
  quantityRemaining: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    default: 0,
    min: 0
  },
  source: {
    type: String,
    enum: ["daily", "permanent"],
    default: "daily"
  },
  // Track which inventory source this came from (for reconciliation)
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupervisorInventory"
  }
}, { _id: false });

// Main Daily Assignment Schema
const DailyAssignmentSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true
  },

  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    required: true
  },

  route: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Route",
    required: true
  },

  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  refillCoordinator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vehicle",
    required: true,
    index: true
  },

  battery: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Battery",
    required: true,
    index: true
  },

  startTime: {
    type: Date,
    default: null
  },

  endTime: {
    type: Date,
    default: null
  },

  status: {
    type: String,
    enum: ["pending", "active", "completed", "cancelled"],
    default: "pending"
  },

  inventory: [InventorySchema],

  stops: [StopTrackingSchema],

  currentLocation: {
    lat: Number,
    lng: Number,
    updatedAt: Date
  },

  locationHistory: {
    type: [LocationHistorySchema],
    default: []
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  totalSales: {
    type: Number,
    default: 0
  },

  totalItemsSold: {
    type: Number,
    default: 0
  },

  inventoryReturned: {
    type: Boolean,
    default: false
  },

  closedAt: Date,
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  cancellationReason: {
    type: String,
    default: null
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }
}, {
  timestamps: true
});

// Add compound indexes
DailyAssignmentSchema.index({ date: 1, team: 1, status: 1 });
DailyAssignmentSchema.index({ rider: 1, date: 1, status: 1 });
DailyAssignmentSchema.index({ vehicle: 1, date: 1, status: 1 });
DailyAssignmentSchema.index({ battery: 1, date: 1, status: 1 });
DailyAssignmentSchema.index({ supervisor: 1, date: 1, status: 1 });
// Index for source field for faster queries
DailyAssignmentSchema.index({ "inventory.source": 1 });

// Pre-save middleware
DailyAssignmentSchema.pre('save', function(next) {
  if (this.stops && Array.isArray(this.stops)) {
    for (let i = 0; i < this.stops.length; i++) {
      const stop = this.stops[i];
      if (!stop._id) {
        stop._id = new mongoose.Types.ObjectId();
      }
      if (!stop.sales) {
        stop.sales = { items: [], totalRevenue: 0, totalItems: 0 };
      }
    }
  }
  
  if (this.inventory && this.inventory.length > 0) {
    this.totalItemsSold = this.inventory.reduce((sum, item) => sum + (item.quantitySold || 0), 0);
    this.totalSales = this.inventory.reduce((sum, item) => sum + ((item.quantitySold || 0) * (item.price || 0)), 0);
    
    // Calculate remaining quantity for each item
    this.inventory.forEach(item => {
      item.quantityRemaining = item.quantityAssigned - (item.quantitySold || 0);
    });
  }
  
  next();
});

// Static method to check resource availability
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

// Method to get inventory by source
DailyAssignmentSchema.methods.getInventoryBySource = function(source) {
  if (!this.inventory) return [];
  return this.inventory.filter(item => item.source === source);
};

// Method to get summary by source
DailyAssignmentSchema.methods.getInventorySummary = function() {
  const dailyItems = this.inventory.filter(item => item.source === "daily");
  const permanentItems = this.inventory.filter(item => item.source === "permanent");
  
  return {
    total: {
      items: this.inventory.length,
      assigned: this.inventory.reduce((sum, i) => sum + i.quantityAssigned, 0),
      sold: this.inventory.reduce((sum, i) => sum + (i.quantitySold || 0), 0),
      remaining: this.inventory.reduce((sum, i) => sum + (i.quantityRemaining || 0), 0)
    },
    daily: {
      items: dailyItems.length,
      assigned: dailyItems.reduce((sum, i) => sum + i.quantityAssigned, 0),
      sold: dailyItems.reduce((sum, i) => sum + (i.quantitySold || 0), 0),
      remaining: dailyItems.reduce((sum, i) => sum + (i.quantityRemaining || 0), 0)
    },
    permanent: {
      items: permanentItems.length,
      assigned: permanentItems.reduce((sum, i) => sum + i.quantityAssigned, 0),
      sold: permanentItems.reduce((sum, i) => sum + (i.quantitySold || 0), 0),
      remaining: permanentItems.reduce((sum, i) => sum + (i.quantityRemaining || 0), 0)
    }
  };
};

// Method to close assignment
DailyAssignmentSchema.methods.closeAssignment = async function(userId) {
  this.status = "completed";
  this.endTime = new Date();
  this.closedAt = new Date();
  this.closedBy = userId;
  this.inventoryReturned = true;
  
  if (this.inventory && this.inventory.length > 0) {
    this.totalItemsSold = this.inventory.reduce((sum, item) => sum + (item.quantitySold || 0), 0);
    this.totalSales = this.inventory.reduce((sum, item) => sum + ((item.quantitySold || 0) * (item.price || 0)), 0);
  }
  
  return this.save();
};

// Method to cancel assignment
DailyAssignmentSchema.methods.cancelAssignment = async function(userId, reason = null) {
  this.status = "cancelled";
  this.endTime = new Date();
  this.closedAt = new Date();
  this.closedBy = userId;
  this.inventoryReturned = true;
  this.cancellationReason = reason;
  return this.save();
};

// Method to accept assignment
DailyAssignmentSchema.methods.acceptAssignment = async function() {
  if (this.status !== "pending") {
    throw new Error(`Cannot accept assignment in ${this.status} status`);
  }
  this.status = "active";
  return this.save();
};

// Method to start assignment
DailyAssignmentSchema.methods.startAssignment = async function() {
  if (this.status !== "active") {
    throw new Error(`Cannot start assignment in ${this.status} status`);
  }
  if (this.startTime) {
    throw new Error("Assignment already started");
  }
  this.startTime = new Date();
  
  if (this.stops && this.stops.length > 0 && this.stops[0].status === "pending") {
    this.stops[0].status = "in-progress";
    this.stops[0].arrivedAt = new Date();
  }
  
  return this.save();
};

// Method to record sales for an item
DailyAssignmentSchema.methods.recordSale = async function(foodItemId, quantity, stopId = null) {
  const inventoryItem = this.inventory.find(
    item => String(item.foodItem) === String(foodItemId)
  );
  
  if (!inventoryItem) {
    throw new Error("Item not found in assignment inventory");
  }
  
  const remaining = inventoryItem.quantityRemaining || (inventoryItem.quantityAssigned - (inventoryItem.quantitySold || 0));
  
  if (quantity > remaining) {
    throw new Error(`Cannot sell ${quantity} items. Only ${remaining} remaining`);
  }
  
  inventoryItem.quantitySold = (inventoryItem.quantitySold || 0) + quantity;
  inventoryItem.quantityRemaining = inventoryItem.quantityAssigned - inventoryItem.quantitySold;
  
  // Update stop sales if stopId provided
  if (stopId) {
    const stop = this.getStopById(stopId);
    if (stop && stop.sales) {
      const existingItem = stop.sales.items.find(
        item => String(item.foodItemId) === String(foodItemId)
      );
      
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        stop.sales.items.push({
          foodItemId: foodItemId,
          name: inventoryItem.name,
          quantity: quantity,
          price: inventoryItem.price
        });
      }
      
      stop.sales.totalItems = (stop.sales.totalItems || 0) + quantity;
      stop.sales.totalRevenue = (stop.sales.totalRevenue || 0) + (quantity * inventoryItem.price);
    }
  }
  
  // Update totals
  this.totalItemsSold = (this.totalItemsSold || 0) + quantity;
  this.totalSales = (this.totalSales || 0) + (quantity * inventoryItem.price);
  
  return this.save();
};

// Method to add location
DailyAssignmentSchema.methods.addLocation = async function(lat, lng) {
  if (!this.locationHistory) {
    this.locationHistory = [];
  }
  
  this.locationHistory.push({
    lat,
    lng,
    timestamp: new Date()
  });
  
  if (this.locationHistory.length > 500) {
    this.locationHistory = this.locationHistory.slice(-500);
  }
  
  this.currentLocation = {
    lat,
    lng,
    updatedAt: new Date()
  };
  
  return this.save();
};

// Method to get location history
DailyAssignmentSchema.methods.getLocationHistory = function(startDate, endDate) {
  if (!this.locationHistory) return [];
  
  return this.locationHistory.filter(loc => {
    const locTime = new Date(loc.timestamp);
    return (!startDate || locTime >= startDate) && (!endDate || locTime <= endDate);
  });
};

// Method to get stop by ID
DailyAssignmentSchema.methods.getStopById = function(stopId) {
  if (!this.stops) return null;
  return this.stops.find(stop => stop._id && stop._id.toString() === stopId);
};

// Method to update stop status
DailyAssignmentSchema.methods.updateStopStatus = async function(stopId, status) {
  const stop = this.getStopById(stopId);
  if (!stop) {
    throw new Error("Stop not found");
  }
  
  stop.status = status;
  
  if (status === "in-progress") {
    stop.arrivedAt = new Date();
  } else if (status === "completed") {
    stop.completedAt = new Date();
    if (stop.arrivedAt) {
      stop.durationMinutes = Math.round((stop.completedAt - stop.arrivedAt) / 60000);
    }
  }
  
  return this.save();
};

// Method to get stop analytics
DailyAssignmentSchema.methods.getStopAnalytics = function() {
  if (!this.stops) return {};
  
  const completedStops = this.stops.filter(s => s.status === "completed");
  const inProgressStops = this.stops.filter(s => s.status === "in-progress");
  
  return {
    totalStops: this.stops.length,
    completedStops: completedStops.length,
    inProgressStops: inProgressStops.length,
    pendingStops: this.stops.filter(s => s.status === "pending").length,
    averageStopDuration: completedStops.length > 0 ? 
      completedStops.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / completedStops.length : 0,
    totalStopRevenue: completedStops.reduce((sum, s) => sum + (s.sales?.totalRevenue || 0), 0),
    totalStopItems: completedStops.reduce((sum, s) => sum + (s.sales?.totalItems || 0), 0)
  };
};

// Virtuals
DailyAssignmentSchema.virtual('progress').get(function() {
  if (!this.stops || this.stops.length === 0) return 0;
  const completed = this.stops.filter(s => s.status === 'completed').length;
  const inProgress = this.stops.filter(s => s.status === 'in-progress').length;
  return ((completed + (inProgress ? 0.5 : 0)) / this.stops.length) * 100;
});

DailyAssignmentSchema.virtual('completionRate').get(function() {
  if (!this.stops || this.stops.length === 0) return 0;
  const completed = this.stops.filter(s => s.status === 'completed').length;
  return (completed / this.stops.length) * 100;
});

DailyAssignmentSchema.virtual('totalTravelTime').get(function() {
  if (!this.startTime || !this.endTime) return 0;
  return Math.round((this.endTime - this.startTime) / 60000);
});

DailyAssignmentSchema.virtual('activeTime').get(function() {
  if (!this.stops || this.stops.length === 0) return 0;
  const totalStopTime = this.stops.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  return totalStopTime;
});

// Ensure virtuals are included
DailyAssignmentSchema.set('toJSON', { virtuals: true });
DailyAssignmentSchema.set('toObject', { virtuals: true });

export const DailyAssignment = mongoose.model("DailyAssignment", DailyAssignmentSchema);
export default DailyAssignment;