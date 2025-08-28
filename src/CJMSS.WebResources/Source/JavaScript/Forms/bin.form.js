
/* === PDG Bin Form JavaScript — v3 (no ctx.getValue usage anywhere) === */
/* Library: pdg_binform */
var PDG = PDG || {};
PDG.Bin = {

    // ========= Core Event Handlers =========

    onLoad: function (executionContext) {
        var formContext = executionContext.getFormContext();

        try {
            if (formContext.ui.getFormType() === 1) { // Create
                this.setDefaults(formContext);
            }

            this.setupCalculatedFields(formContext);
            this.setupFieldEvents(formContext);
            this.setupTabLogic(formContext);
            this.setupFormNotifications(formContext);

            if (formContext.ui.getFormType() !== 1) { // Not create mode
                this.loadBinDetails(formContext);
            }

            // Initial calculations
            this.runInitialCalculations(formContext);

            // Auto bin code / barcode helpers
            this.setupAutoBinCode(formContext);
            this.setupBarcodeManagement(formContext);

            // Periodic refresh
            this.setupAutoRefresh(formContext);

            console.log("PDG Bin form loaded successfully");
        } catch (e) {
            console.error("Error in Bin onLoad:", e);
            this.showNotification(formContext, "Error loading form: " + e.message, "ERROR", "load_error");
        }
    },

    onSave: function (executionContext) {
        var formContext = executionContext.getFormContext();

        try {
            if (!this.validateBin(formContext) || !this.validateDimensions(formContext)) {
                executionContext.getEventArgs().preventDefault();
                return false;
            }

            this.calculateVolume(formContext);
            this.updateCapacityPercentages(formContext);
            this.updateLocationPath(formContext);
            this.updateWarehouseName(formContext);

            if (formContext.PDG_RefreshInterval) {
                clearInterval(formContext.PDG_RefreshInterval);
            }

            this.clearTemporaryNotifications(formContext);
            console.log("PDG Bin form saved successfully");
            return true;
        } catch (e) {
            console.error("Error in Bin onSave:", e);
            this.showNotification(formContext, "Error saving form: " + e.message, "ERROR", "save_error");
            executionContext.getEventArgs().preventDefault();
            return false;
        }
    },

    // ========= Initialization =========

    setDefaults: function (formContext) {
        try {
            var binType = formContext.getAttribute("pdg_bintype");
            if (binType && (binType.getValue() === null || binType.getValue() === undefined)) {
                binType.setValue(100000000);
            }

            var lastCountBy = formContext.getAttribute("pdg_lastcountbyid");
            if (lastCountBy) {
                var userSettings = Xrm.Utility.getGlobalContext().userSettings;
                lastCountBy.setValue([{
                    id: userSettings.userId,
                    name: userSettings.userName,
                    entityType: "systemuser"
                }]);
            }

            var temperature = formContext.getAttribute("pdg_temperature");
            if (temperature && !temperature.getValue()) temperature.setValue(20);

            var humidity = formContext.getAttribute("pdg_humidity");
            if (humidity && !humidity.getValue()) humidity.setValue(50);

            var currentOccupancy = formContext.getAttribute("pdg_currentoccupancy");
            if (currentOccupancy && !currentOccupancy.getValue()) currentOccupancy.setValue(0);

            var currentWeight = formContext.getAttribute("pdg_currentweight");
            if (currentWeight && !currentWeight.getValue()) currentWeight.setValue(0);

            this.initializePercentages(formContext);
        } catch (e) {
            console.warn("Error setting defaults:", e);
        }
    },

    setupCalculatedFields: function (formContext) {
        try {
            ["pdg_capacitypercentage", "pdg_weightpercentage", "pdg_volume", "pdg_warehousename", "pdg_locationpath"]
                .forEach(function (field) {
                    var c = formContext.getControl(field);
                    if (c) c.setDisabled(true);
                });

            ["createdby", "createdon", "createdonbehalfby", "modifiedby", "modifiedon", "modifiedonbehalfby"]
                .forEach(function (field) {
                    var c = formContext.getControl(field);
                    if (c) c.setDisabled(true);
                });
        } catch (e) {
            console.warn("Error setting up calculated fields:", e);
        }
    },

    // ========= Events / Real-time Calculations =========

    setupFieldEvents: function (formContext) {
        try {
            var self = this;
            console.log("Setting up field events for real-time calculations...");

            // Attribute-level addOnChange across the board
            ["pdg_length", "pdg_width", "pdg_height"].forEach(function (f) {
                var a = formContext.getAttribute(f);
                if (a && typeof a.addOnChange === "function") {
                    a.addOnChange(function () { self.calculateVolumeRealTime(formContext); });
                }
            });

            ["pdg_capacity", "pdg_currentoccupancy"].forEach(function (f) {
                var a = formContext.getAttribute(f);
                if (a && typeof a.addOnChange === "function") {
                    a.addOnChange(function () { self.updateCapacityPercentageRealTime(formContext); });
                }
            });

            ["pdg_weightcapacity", "pdg_currentweight"].forEach(function (f) {
                var a = formContext.getAttribute(f);
                if (a && typeof a.addOnChange === "function") {
                    a.addOnChange(function () { self.updateWeightPercentageRealTime(formContext); });
                }
            });

            ["pdg_aisle", "pdg_row", "pdg_shelf", "pdg_position"].forEach(function (f) {
                var a = formContext.getAttribute(f);
                if (a && typeof a.addOnChange === "function") {
                    a.addOnChange(function () { self.updateLocationPath(formContext); });
                }
            });

            var wh = formContext.getAttribute("pdg_warehouseid");
            if (wh && typeof wh.addOnChange === "function") {
                wh.addOnChange(function (executionContext) { self.onWarehouseChange(executionContext); });
            }

            var bc = formContext.getAttribute("pdg_bincode");
            if (bc && typeof bc.addOnChange === "function") {
                bc.addOnChange(function (executionContext) { self.onBinCodeChange(executionContext); });
            }

            var capUom = formContext.getAttribute("pdg_capacityuomid");
            if (capUom && typeof capUom.addOnChange === "function") {
                capUom.addOnChange(function () { self.updateCapacityPercentageRealTime(formContext); });
            }

            console.log("Field events setup completed");
        } catch (e) {
            console.error("Error setting up field events:", e);
        }
    },

    setupTabLogic: function (formContext) {
        try {
            var tabs = formContext.ui.tabs;
            var isCreate = formContext.ui.getFormType() === 1;

            var historyTab = tabs.get("HISTORY");
            if (historyTab) historyTab.setVisible(!isCreate);

            var inventoryTab = tabs.get("INVENTORY");
            if (inventoryTab) inventoryTab.setVisible(!isCreate);
        } catch (e) {
            console.warn("Error setting up tab logic:", e);
        }
    },

    setupFormNotifications: function (formContext) {
        try {
            this.clearAllNotifications(formContext);
            if (formContext.ui.getFormType() === 1) {
                this.showNotification(
                    formContext,
                    "Select a warehouse to get started. Bin code and location details will be auto-populated.",
                    "INFO",
                    "getting_started",
                    false
                );
            }
        } catch (e) {
            console.warn("Error setting up form notifications:", e);
        }
    },

    // ========= Calculations =========

    initializePercentages: function (formContext) {
        try {
            var c = formContext.getAttribute("pdg_capacitypercentage");
            if (c && (c.getValue() === null || c.getValue() === undefined)) c.setValue(0);

            var w = formContext.getAttribute("pdg_weightpercentage");
            if (w && (w.getValue() === null || w.getValue() === undefined)) w.setValue(0);
        } catch (e) {
            console.warn("Error initializing percentages:", e);
        }
    },

    updateCapacityPercentages: function (formContext) {
        try {
            this.updateCapacityPercentageRealTime(formContext);
            this.updateWeightPercentageRealTime(formContext);
            this.updateCapacityStatus(formContext);
        } catch (e) {
            console.warn("Error updating capacity percentages:", e);
        }
    },

    updateCapacityPercentageRealTime: function (formContext) {
        try {
            var capacity = formContext.getAttribute("pdg_capacity");
            var currentOccupancy = formContext.getAttribute("pdg_currentoccupancy");
            var out = formContext.getAttribute("pdg_capacitypercentage");

            if (!out) return;

            var cap = capacity ? (capacity.getValue() || 0) : 0;
            var occ = currentOccupancy ? (currentOccupancy.getValue() || 0) : 0;

            var pct = 0;
            if (cap > 0) pct = Math.round(((occ / cap) * 100) * 100) / 100;

            out.setValue(pct);
            this.updateCapacityStatus(formContext);
        } catch (e) {
            console.error("Error updating capacity percentage:", e);
        }
    },

    updateWeightPercentageRealTime: function (formContext) {
        try {
            var weightCapacity = formContext.getAttribute("pdg_weightcapacity");
            var currentWeight = formContext.getAttribute("pdg_currentweight");
            var out = formContext.getAttribute("pdg_weightpercentage");

            if (!out) return;

            var cap = weightCapacity ? (weightCapacity.getValue() || 0) : 0;
            var cur = currentWeight ? (currentWeight.getValue() || 0) : 0;

            var pct = 0;
            if (cap > 0) pct = Math.round(((cur / cap) * 100) * 100) / 100;

            out.setValue(pct);
            this.updateCapacityStatus(formContext);
        } catch (e) {
            console.error("Error updating weight percentage:", e);
        }
    },

    calculateVolumeRealTime: function (formContext) {
        try {
            var L = formContext.getAttribute("pdg_length");
            var W = formContext.getAttribute("pdg_width");
            var H = formContext.getAttribute("pdg_height");
            var out = formContext.getAttribute("pdg_volume");

            if (!out) return;

            var l = L ? (L.getValue() || 0) : 0;
            var w = W ? (W.getValue() || 0) : 0;
            var h = H ? (H.getValue() || 0) : 0;

            var v = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 1e9 : 0;
            out.setValue(v);

            if (v > 0) {
                this.showNotification(formContext, "Volume calculated: " + v.toLocaleString() + " mm³", "INFO", "volume_calculated");
            }
        } catch (e) {
            console.error("Error calculating volume:", e);
        }
    },

    // keep a thin wrapper for onSave reuse
    calculateVolume: function (formContext) {
        this.calculateVolumeRealTime(formContext);
    },

    updateCapacityStatus: function (formContext) {
        try {
            var c = formContext.getAttribute("pdg_capacitypercentage");
            var w = formContext.getAttribute("pdg_weightpercentage");

            var cp = c ? c.getValue() : 0;
            var wp = w ? w.getValue() : 0;
            var maxp = Math.max(cp || 0, wp || 0);

            this.clearNotification(formContext, "capacity_status");

            if (maxp >= 95) {
                this.showNotification(formContext, "Critical: Bin is at " + maxp.toFixed(1) + "% capacity", "ERROR", "capacity_status", true);
            } else if (maxp >= 80) {
                this.showNotification(formContext, "Warning: Bin is at " + maxp.toFixed(1) + "% capacity", "WARNING", "capacity_status", true);
            } else if (maxp > 0) {
                this.showNotification(formContext, "Normal: Bin is at " + maxp.toFixed(1) + "% capacity", "INFO", "capacity_status");
            }
        } catch (e) {
            console.warn("Error updating capacity status:", e);
        }
    },

    updateLocationPath: function (formContext) {
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var aisle = formContext.getAttribute("pdg_aisle");
            var row = formContext.getAttribute("pdg_row");
            var shelf = formContext.getAttribute("pdg_shelf");
            var position = formContext.getAttribute("pdg_position");
            var out = formContext.getAttribute("pdg_locationpath");

            if (!out) return;

            var parts = [];
            var wh = warehouse && warehouse.getValue();
            if (wh && wh.length) parts.push(wh[0].name);
            var a = aisle && aisle.getValue(); if (a) parts.push("A:" + a);
            var r = row && row.getValue(); if (r) parts.push("R:" + r);
            var s = shelf && shelf.getValue(); if (s) parts.push("S:" + s);
            var p = position && position.getValue(); if (p) parts.push("P:" + p);

            var path = parts.join(" > ");
            out.setValue(path);
            formContext._pdg_locationPath = path;
        } catch (e) {
            console.warn("Error updating location path:", e);
        }
    },

    updateWarehouseName: function (formContext) {
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var out = formContext.getAttribute("pdg_warehousename");
            if (!out) return;

            var wh = warehouse && warehouse.getValue();
            out.setValue(wh && wh.length ? wh[0].name : null);
        } catch (e) {
            console.warn("Error updating warehouse name:", e);
        }
    },

    // ========= Change Handlers =========

    onWarehouseChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var wh = warehouse ? warehouse.getValue() : null;

            this.updateWarehouseName(formContext);
            this.updateLocationPath(formContext);

            if (wh && wh.length) {
                this.clearNotification(formContext, "getting_started");
                if (formContext.ui.getFormType() === 1) {
                    var binCode = formContext.getAttribute("pdg_bincode");
                    if (binCode && !binCode.getValue()) {
                        var self = this;
                        setTimeout(function () { self.generateBinCode(formContext); }, 500);
                    }
                }
                this.showNotification(formContext, "Warehouse selected: " + wh[0].name, "INFO", "warehouse_selected");
            }
        } catch (e) {
            console.warn("Error in onWarehouseChange:", e);
        }
    },

    onBinCodeChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        try {
            var binCode = formContext.getAttribute("pdg_bincode");
            var val = binCode ? binCode.getValue() : null;

            if (val) {
                this.generateBarcode(formContext);
                this.checkDuplicateBinCode(formContext, val);
            }
        } catch (e) {
            console.warn("Error in onBinCodeChange:", e);
        }
    },

    // ========= Validation =========

    validateBin: function (formContext) {
        var ok = true;
        try {
            this.clearValidationNotifications(formContext);

            var binCode = formContext.getAttribute("pdg_bincode");
            if (!binCode || !binCode.getValue() || binCode.getValue().trim() === "") {
                this.showNotification(formContext, "Bin Code is required", "ERROR", "validation_bincode", false);
                ok = false;
            }

            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var wh = warehouse ? warehouse.getValue() : null;
            if (!wh || !wh.length) {
                this.showNotification(formContext, "Warehouse is required", "ERROR", "validation_warehouse", false);
                ok = false;
            }

            var capacity = formContext.getAttribute("pdg_capacity");
            var currentOccupancy = formContext.getAttribute("pdg_currentoccupancy");
            var cap = capacity ? capacity.getValue() : 0;
            var occ = currentOccupancy ? currentOccupancy.getValue() : 0;
            if (cap && cap > 0 && occ > cap) {
                this.showNotification(formContext, "Current occupancy cannot exceed total capacity", "ERROR", "validation_capacity", false);
                ok = false;
            }

            var weightCapacity = formContext.getAttribute("pdg_weightcapacity");
            var currentWeight = formContext.getAttribute("pdg_currentweight");
            var wcap = weightCapacity ? weightCapacity.getValue() : 0;
            var wcur = currentWeight ? currentWeight.getValue() : 0;
            if (wcap && wcap > 0 && wcur > wcap) {
                this.showNotification(formContext, "Current weight cannot exceed weight capacity", "ERROR", "validation_weight", false);
                ok = false;
            }
        } catch (e) {
            console.warn("Error in validateBin:", e);
            ok = false;
        }
        return ok;
    },

    validateDimensions: function (formContext) {
        var ok = true;
        try {
            var L = formContext.getAttribute("pdg_length");
            var W = formContext.getAttribute("pdg_width");
            var H = formContext.getAttribute("pdg_height");
            var l = L ? L.getValue() : 0;
            var w = W ? W.getValue() : 0;
            var h = H ? H.getValue() : 0;

            if ((l || w || h) && !(l && w && h)) {
                this.showNotification(formContext, "If providing dimensions, all three (Length, Width, Height) are required", "WARNING", "validation_dimensions", false);
                ok = false;
            }
            if (l && l <= 0) { this.showNotification(formContext, "Length must be a positive number", "ERROR", "validation_length", false); ok = false; }
            if (w && w <= 0) { this.showNotification(formContext, "Width must be a positive number", "ERROR", "validation_width", false); ok = false; }
            if (h && h <= 0) { this.showNotification(formContext, "Height must be a positive number", "ERROR", "validation_height", false); ok = false; }
        } catch (e) {
            console.warn("Error in validateDimensions:", e);
            ok = false;
        }
        return ok;
    },

    // ========= Auto-generation / Data load =========

    setupAutoBinCode: function (formContext) {
        try {
            if (formContext.ui.getFormType() === 1) {
                var binCode = formContext.getAttribute("pdg_bincode");
                if (binCode && !binCode.getValue()) {
                    this.showNotification(formContext, "Select a warehouse first, then we can auto-generate a bin code for you", "INFO", "bincode_tip");
                }
            }
        } catch (e) {
            console.warn("Error in setupAutoBinCode:", e);
        }
    },

    setupBarcodeManagement: function (formContext) {
        try {
            var bcCtrl = formContext.getControl("pdg_barcode");
            var qrCtrl = formContext.getControl("pdg_qrcode");
            if (bcCtrl) bcCtrl.setDisabled(true);
            if (qrCtrl) qrCtrl.setDisabled(true);
        } catch (e) {
            console.warn("Error in setupBarcodeManagement:", e);
        }
    },

    generateBinCode: function (formContext) {
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var aisle = formContext.getAttribute("pdg_aisle");
            var row = formContext.getAttribute("pdg_row");
            var shelf = formContext.getAttribute("pdg_shelf");

            var wh = warehouse ? warehouse.getValue() : null;
            var a = aisle ? aisle.getValue() : null;
            var r = row ? row.getValue() : null;
            var s = shelf ? shelf.getValue() : null;

            if (wh && wh.length) {
                var warehouseCode = wh[0].name.substring(0, 2).toUpperCase();
                var aisleCode = a ? a.substring(0, 2).toUpperCase() : "00";
                var rowCode = r ? r.substring(0, 2).toUpperCase() : "00";
                var shelfCode = s ? s.substring(0, 2).toUpperCase() : "00";
                var randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

                var generatedCode = warehouseCode + "-" + aisleCode + rowCode + shelfCode + "-" + randomNum;

                var binCodeAttr = formContext.getAttribute("pdg_bincode");
                if (binCodeAttr) binCodeAttr.setValue(generatedCode);

                this.showNotification(formContext, "Bin code auto-generated: " + generatedCode, "INFO", "bincode_generated");
                this.clearNotification(formContext, "bincode_tip");
            }
        } catch (e) {
            console.warn("Error generating bin code:", e);
        }
    },

    generateBarcode: function (formContext) {
        try {
            var binCode = formContext.getAttribute("pdg_bincode");
            var code = binCode ? binCode.getValue() : null;
            if (!code) return;

            var barcodeAttr = formContext.getAttribute("pdg_barcode");
            if (barcodeAttr && !barcodeAttr.getValue()) barcodeAttr.setValue(code);

            var qrcodeAttr = formContext.getAttribute("pdg_qrcode");
            if (qrcodeAttr && !qrcodeAttr.getValue()) qrcodeAttr.setValue(code);
        } catch (e) {
            console.warn("Error generating barcode:", e);
        }
    },

    runInitialCalculations: function (formContext) {
        try {
            this.calculateVolumeRealTime(formContext);
            this.updateCapacityPercentageRealTime(formContext);
            this.updateWeightPercentageRealTime(formContext);
            this.updateLocationPath(formContext);
            this.updateWarehouseName(formContext);

            var binCode = formContext.getAttribute("pdg_bincode");
            var barcode = formContext.getAttribute("pdg_barcode");
            if (binCode && binCode.getValue() && barcode && !barcode.getValue()) {
                this.generateBarcode(formContext);
            }
        } catch (e) {
            console.error("Error running initial calculations:", e);
        }
    },

    loadBinDetails: function (formContext) {
        try {
            var binId = formContext.data.entity.getId();
            if (binId) {
                this.setupTabLogic(formContext);
                this.loadCurrentOccupancy(formContext, binId);
            }
        } catch (e) {
            console.warn("Error loading bin details:", e);
        }
    },

    loadCurrentOccupancy: function (formContext, binId) {
        try {
            this.showNotification(formContext, "Loading current occupancy data...", "INFO", "loading_occupancy");
            var self = this;
            setTimeout(function () {
                self.clearNotification(formContext, "loading_occupancy");
                self.updateCapacityPercentages(formContext);
            }, 1000);
        } catch (e) {
            console.warn("Error loading current occupancy:", e);
        }
    },

    // ========= Notifications / Utilities =========

    showNotification: function (formContext, message, level, uniqueId, autoClear) {
        try {
            if (autoClear === undefined) autoClear = true;
            formContext.ui.setFormNotification(message, level, uniqueId);
            if (autoClear) {
                var timeout = level === "ERROR" ? 8000 : 4000;
                var self = this;
                setTimeout(function () { self.clearNotification(formContext, uniqueId); }, timeout);
            }
        } catch (e) {
            console.warn("Error showing notification:", e);
        }
    },

    clearNotification: function (formContext, uniqueId) {
        try {
            formContext.ui.clearFormNotification(uniqueId);
        } catch (e) {
            console.warn("Error clearing notification:", e);
        }
    },

    clearValidationNotifications: function (formContext) {
        try {
            ["validation_bincode", "validation_warehouse", "validation_capacity",
                "validation_weight", "validation_dimensions", "validation_length",
                "validation_width", "validation_height"].forEach(function (id) {
                    PDG.Bin.clearNotification(formContext, id);
                });
        } catch (e) {
            console.warn("Error clearing validation notifications:", e);
        }
    },

    clearTemporaryNotifications: function (formContext) {
        try {
            ["volume_calculated", "bincode_generated", "warehouse_selected",
                "loading_occupancy", "bincode_tip", "capacity_realtime", "weight_realtime"]
                .forEach(function (id) { PDG.Bin.clearNotification(formContext, id); });
        } catch (e) {
            console.warn("Error clearing temporary notifications:", e);
        }
    },

    clearAllNotifications: function (formContext) {
        try {
            ["load_error", "save_error", "getting_started", "capacity_status",
                "volume_calculated", "bincode_generated", "warehouse_selected",
                "loading_occupancy", "bincode_tip", "checking_duplicate",
                "validation_bincode", "validation_warehouse", "validation_capacity",
                "validation_weight", "validation_dimensions", "validation_length",
                "validation_width", "validation_height"]
                .forEach(function (id) { PDG.Bin.clearNotification(formContext, id); });
        } catch (e) {
            console.warn("Error clearing all notifications:", e);
        }
    },

    checkDuplicateBinCode: function (formContext, binCode) {
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var wh = warehouse ? warehouse.getValue() : null;
            if (wh && wh.length) {
                this.showNotification(formContext, "Checking bin code uniqueness in " + wh[0].name + "...", "INFO", "checking_duplicate");
            }
        } catch (e) {
            console.warn("Error checking duplicate bin code:", e);
        }
    },

    setupAutoRefresh: function (formContext) {
        try {
            if (formContext.ui.getFormType() !== 1) {
                var self = this;
                formContext.PDG_RefreshInterval = setInterval(function () {
                    var binId = formContext.data.entity.getId();
                    if (binId) self.loadCurrentOccupancy(formContext, binId);
                }, 300000);
            }
        } catch (e) {
            console.warn("Error setting up auto-refresh:", e);
        }
    },

    // ========= Public API =========

    getCapacityInfo: function (formContext) {
        try {
            var capacity = formContext.getAttribute("pdg_capacity");
            var weightCapacity = formContext.getAttribute("pdg_weightcapacity");
            var currentOccupancy = formContext.getAttribute("pdg_currentoccupancy");
            var currentWeight = formContext.getAttribute("pdg_currentweight");
            var capacityPercentage = formContext.getAttribute("pdg_capacitypercentage");
            var weightPercentage = formContext.getAttribute("pdg_weightpercentage");

            var capacityValue = capacity ? capacity.getValue() : 0;
            var weightCapacityValue = weightCapacity ? weightCapacity.getValue() : 0;
            var occupancyValue = currentOccupancy ? currentOccupancy.getValue() : 0;
            var currentWeightValue = currentWeight ? currentWeight.getValue() : 0;
            var capacityPercentageValue = capacityPercentage ? capacityPercentage.getValue() : 0;
            var weightPercentageValue = weightPercentage ? weightPercentage.getValue() : 0;

            return {
                hasVolumeCapacity: capacityValue > 0,
                hasWeightCapacity: weightCapacityValue > 0,
                volumeUtilization: capacityPercentageValue,
                weightUtilization: weightPercentageValue,
                availableCapacity: Math.max(0, capacityValue - occupancyValue),
                availableWeight: Math.max(0, weightCapacityValue - currentWeightValue),
                maxUtilization: Math.max(capacityPercentageValue, weightPercentageValue)
            };
        } catch (e) {
            console.warn("Error getting capacity info:", e);
            return {
                hasVolumeCapacity: false,
                hasWeightCapacity: false,
                volumeUtilization: 0,
                weightUtilization: 0,
                availableCapacity: 0,
                availableWeight: 0,
                maxUtilization: 0
            };
        }
    }
};

// ========= Ribbon Button Functions =========
PDG.Bin.generateBinCodeRibbon = function (primaryControl) {
    try {
        var formContext = primaryControl;
        PDG.Bin.generateBinCode(formContext);
    } catch (e) {
        console.error("Error in generateBinCodeRibbon:", e);
    }
};

PDG.Bin.refreshInventoryRibbon = function (primaryControl) {
    try {
        var formContext = primaryControl;
        var binId = formContext.data.entity.getId();
        if (binId) PDG.Bin.loadCurrentOccupancy(formContext, binId);
    } catch (e) {
        console.error("Error in refreshInventoryRibbon:", e);
    }
};

PDG.Bin.recalculatePercentagesRibbon = function (primaryControl) {
    try {
        var formContext = primaryControl;
        PDG.Bin.updateCapacityPercentages(formContext);
        PDG.Bin.showNotification(formContext, "Percentages recalculated successfully", "INFO", "recalculate_success");
    } catch (e) {
        console.error("Error in recalculatePercentagesRibbon:", e);
    }
};

// ========= Lookup Filtering Helper =========
// NOTE: uses ATTRIBUTE-level onChange for reliability; no ctx.getValue usage.
PDG.Bin.setupBinLookupFiltering = function (formContext, binLookupFieldName, warehouseFieldName) {
    try {
        var warehouseAttr = formContext.getAttribute(warehouseFieldName);
        var binControl = formContext.getControl(binLookupFieldName);

        if (warehouseAttr && binControl) {
            var handler = function () {
                var warehouse = warehouseAttr.getValue();

                if (warehouse && warehouse.length > 0) {
                    var filter = "<filter type='and'>" +
                        "<condition attribute='pdg_warehouseid' operator='eq' value='" + warehouse[0].id.replace(/[{}]/g, "") + "' />" +
                        "<condition attribute='statecode' operator='eq' value='0' />" +
                        "</filter>";

                    binControl.addCustomFilter(filter);
                    var binAttr = formContext.getAttribute(binLookupFieldName);
                    if (binAttr) binAttr.setValue(null);
                } else {
                    binControl.addCustomFilter("");
                    var binAttr2 = formContext.getAttribute(binLookupFieldName);
                    if (binAttr2) binAttr2.setValue(null);
                }
            };
            warehouseAttr.addOnChange(handler);
            // also run once
            handler();
        }
    } catch (e) {
        console.warn("Error setting up bin lookup filtering:", e);
    }
};
