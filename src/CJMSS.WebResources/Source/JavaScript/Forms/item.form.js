/* Enhanced PDG Item Form - Complete Jewelry Inventory Management */
var PDG = PDG || {};

PDG.Item = {

    // Configuration and Constants
    Config: {
        REFRESH_INTERVAL: 60000, // 1 minute
        LOW_STOCK_THRESHOLD: 5,
        CRITICAL_STOCK_THRESHOLD: 0,
        AUTO_SAVE_INTERVAL: 300000, // 5 minutes
        CACHE_DURATION: 300000, // 5 minutes

        // Jewelry specific thresholds
        WEIGHT_PRECISION: 3,
        GOLD_PURITY_STANDARDS: [14, 18, 21, 22, 24],

        // Performance thresholds
        MARGIN_CRITICAL: 15,
        MARGIN_WARNING: 25,

        // WebResource IDs
        WR_IDS: {
            stockDashboard: 'WebResource_StockStatusDashboard',
            quickActions: 'WebResource_QuickActions',
            marginAnalysis: 'WebResource_MarginAnalysis',
            alertsPanel: 'WebResource_AlertsPanel',
            inventoryAnalytics: 'WebResource_InventoryAnalytics',
            itemHeader: 'WebResource_ItemHeader',
            transactionTimeline: 'WebResource_TransactionTimeline',
            itemBarcode: 'WebResource_ItemBarcode',
            itemQR: 'WebResource_ItemQR',
            stockBar: 'WebResource_StockBar'
        }
    },

    // ========= Core Event Handlers =========

    onLoad: function (executionContext) {
        var formContext = executionContext.getFormContext();

        try {
            // Initialize form state tracking
            this.initializeFormState(formContext);

            // Set defaults for new records
            if (formContext.ui.getFormType() === 1) { // Create
                this.setDefaults(formContext);
            }

            // Lock calculated fields
            this.lockCalculatedFields(formContext);

            // Setup cascading field dependencies
            this.setupFieldDependencies(formContext);

            // Setup all field event handlers
            this.setupFieldEvents(formContext);

            // Initialize enhanced features for existing records
            if (formContext.ui.getFormType() !== 1) { // Not create mode
                this.initializeExistingRecord(formContext);
            }

            // Setup auto-refresh and real-time updates
            this.setupRealTimeUpdates(formContext);

            // Initialize WebResource components
            this.initializeWebResources(formContext);

            // Setup keyboard shortcuts and accessibility
            this.setupAccessibilityFeatures(formContext);

            console.log("PDG Item Form Enhanced - Loaded successfully");

        } catch (error) {
            console.error("Error in PDG.Item.onLoad:", error);
            this.showErrorNotification(formContext, "Form initialization error: " + error.message);
        }
    },

    onSave: function (executionContext) {
        var formContext = executionContext.getFormContext();

        try {
            // Enhanced validation before save
            if (!this.validateCompleteRecord(formContext)) {
                executionContext.getEventArgs().preventDefault();
                return false;
            }

            // Calculate and update computed fields
            this.calculateAllComputedFields(formContext);

            // Update cache and clear intervals
            this.cleanupFormState(formContext);

            // Log save action for audit
            this.logSaveAction(formContext);

            return true;

        } catch (error) {
            console.error("Error in PDG.Item.onSave:", error);
            this.showErrorNotification(formContext, "Save error: " + error.message);
            executionContext.getEventArgs().preventDefault();
            return false;
        }
    },

    // ========= Form State Management =========

    initializeFormState: function (formContext) {
        // Initialize form-level state tracking
        formContext.PDG_FormState = {
            isLoaded: false,
            refreshIntervals: [],
            cache: {},
            lastRefresh: new Date(),
            isDirty: false,
            validationErrors: [],
            enhancedFeaturesLoaded: false
        };

        // Setup form change tracking
        var self = this;
        formContext.data.entity.addOnSave(function () {
            formContext.PDG_FormState.isDirty = false;
            formContext.PDG_FormState.lastSave = new Date();
        });
    },

    cleanupFormState: function (formContext) {
        if (formContext.PDG_FormState && formContext.PDG_FormState.refreshIntervals) {
            formContext.PDG_FormState.refreshIntervals.forEach(function (intervalId) {
                clearInterval(intervalId);
            });
            formContext.PDG_FormState.refreshIntervals = [];
        }
    },

    // ========= Initialization Functions =========

    setDefaults: function (formContext) {
        var defaults = {
            "pdg_itemtype": null,
            "pdg_islocked": false,
            "pdg_quantityonhand": 0,
            "pdg_conversionfactor": 1,
            "pdg_hazardousmaterial": false,
            "pdg_negativestockallowed": false,
            "pdg_serialcontrolled": false,
            "pdg_lotcontrolled": false,
            "pdg_expirytracking": false,
            "pdg_qualitycontrolrequired": false,
            "pdg_fastmoving": false
        };

        var self = this;
        Object.keys(defaults).forEach(function (fieldName) {
            self.setIfEmpty(formContext, fieldName, defaults[fieldName]);
        });

        // Set default Currency to USD if available
        this.setDefaultCurrency(formContext);

        // Enhanced barcode generation for new items
        this.generateIntelligentBarcode(formContext);
    },

    setIfEmpty: function (formContext, fieldName, value) {
        var attribute = formContext.getAttribute(fieldName);
        if (attribute) {
            var currentValue = attribute.getValue();
            if (currentValue === null || currentValue === undefined || currentValue === "") {
                try {
                    attribute.setValue(value);
                } catch (e) {
                    console.warn("Could not set default value for " + fieldName + ":", e);
                }
            }
        }
    },

    setDefaultCurrency: function (formContext) {
        var currencyAttr = formContext.getAttribute("transactioncurrencyid");
        if (currencyAttr && !currencyAttr.getValue()) {
            Xrm.WebApi.retrieveMultipleRecords(
                "transactioncurrency",
                "?$select=transactioncurrencyid,currencyname&$filter=isocurrencycode eq 'USD'"
            ).then(function (result) {
                if (result.entities.length > 0) {
                    var currency = result.entities[0];
                    try {
                        currencyAttr.setValue([{
                            id: currency.transactioncurrencyid,
                            name: currency.currencyname,
                            entityType: "transactioncurrency"
                        }]);
                    } catch (e) {
                        console.warn("Could not set default currency:", e);
                    }
                }
            }).catch(function (error) {
                console.warn("Error retrieving default currency:", error);
            });
        }
    },

    lockCalculatedFields: function (formContext) {
        // These fields are calculated by the system
        var fieldsToLock = [
            "pdg_unitcost",
            "pdg_cogp",
            "pdg_totalvalue",
            "pdg_quantityonhand",
            "pdg_totalquantityonhand",
            "pdg_totalquantityonhand_date",
            "pdg_lastphysicalcount",
            "pdg_abcclassification",
            "pdg_annualusagevalue",
            "pdg_movingaveragecost",
            "pdg_averagecost",
            "pdg_volume",
            "pdg_dimensionalweight"
        ];

        fieldsToLock.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (control) {
                control.setDisabled(true);
            }
        });
    },

    // ========= Field Dependencies and Events =========

    setupFieldDependencies: function (formContext) {
        var self = this;

        // Weight validation
        this.setupWeightValidation(formContext);

        // Volume calculation
        this.setupVolumeCalculation(formContext);

        // Family/Subfamily/Category cascading
        this.setupCascadingLookups(formContext);

        // Ensure proper lookup filtering
        this.setupLookupFiltering(formContext);
    },

    setupWeightValidation: function (formContext) {
        var self = this;
        var weightFields = ["pdg_grossweight", "pdg_netweight", "pdg_goldweight", "pdg_stoneweight"];

        weightFields.forEach(function (fieldName) {
            var attribute = formContext.getAttribute(fieldName);
            if (attribute) {
                try {
                    attribute.addOnChange(function () {
                        self.validateWeights(formContext);
                        self.calculateTotalWeight(formContext);
                    });
                } catch (e) {
                    console.warn("Could not add onChange to " + fieldName + ":", e);
                }
            }
        });
    },

    setupVolumeCalculation: function (formContext) {
        var self = this;
        var dimensionFields = ["pdg_length", "pdg_width", "pdg_height"];

        dimensionFields.forEach(function (fieldName) {
            var attribute = formContext.getAttribute(fieldName);
            if (attribute) {
                try {
                    attribute.addOnChange(function () {
                        self.calculateVolume(formContext);
                    });
                } catch (e) {
                    console.warn("Could not add onChange to " + fieldName + ":", e);
                }
            }
        });

        // Initial calculation
        this.calculateVolume(formContext);
    },

    setupCascadingLookups: function (formContext) {
        var self = this;

        // When family changes, filter subfamily
        var familyAttr = formContext.getAttribute("pdg_familyid");
        if (familyAttr) {
            try {
                familyAttr.addOnChange(function (ctx) {
                    self.filterSubfamily(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_familyid:", e);
            }
        }

        // When subfamily changes, filter category
        var subfamilyAttr = formContext.getAttribute("pdg_subfamilyid");
        if (subfamilyAttr) {
            try {
                subfamilyAttr.addOnChange(function (ctx) {
                    self.filterCategory(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_subfamilyid:", e);
            }
        }
    },

    setupLookupFiltering: function (formContext) {
        var self = this;

        // Subfamily lookup filtering
        var subfamilyControl = formContext.getControl("pdg_subfamilyid");
        if (subfamilyControl && typeof subfamilyControl.addPreSearch === "function") {
            try {
                subfamilyControl.addPreSearch(function () {
                    self.filterSubfamily({ getFormContext: function () { return formContext; } });
                });
            } catch (e) {
                console.warn("Could not add preSearch to subfamily control:", e);
            }
        }

        // Category lookup filtering
        var categoryControl = formContext.getControl("pdg_category");
        if (categoryControl && typeof categoryControl.addPreSearch === "function") {
            try {
                categoryControl.addPreSearch(function () {
                    self.filterCategory({ getFormContext: function () { return formContext; } });
                });
            } catch (e) {
                console.warn("Could not add preSearch to category control:", e);
            }
        }
    },

    setupFieldEvents: function (formContext) {
        var self = this;

        // Item type changes
        var itemTypeAttr = formContext.getAttribute("pdg_itemtype");
        if (itemTypeAttr) {
            try {
                itemTypeAttr.addOnChange(function () {
                    self.validateJewelryItem(formContext);
                    self.generateIntelligentBarcode(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_itemtype:", e);
            }
        }

        // Lock status change
        var lockedAttr = formContext.getAttribute("pdg_islocked");
        if (lockedAttr) {
            try {
                lockedAttr.addOnChange(function (ctx) {
                    self.onLockStatusChange(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_islocked:", e);
            }
        }

        // Setup tracking method changes
        this.setupTrackingMethodEvents(formContext);

        // Setup costing and pricing events
        this.setupCostingEvents(formContext);

        // Setup barcode events
        this.setupBarcodeEvents(formContext);

        // Setup customs category -> percentage binding
        this.setupCustomsCategoryPercentage(formContext);

        // Additional validations
        this.setupReorderValidation(formContext);
        this.setupUomConversionValidation(formContext);
    },

    setupReorderValidation: function (formContext) {
        var self = this;
        ["pdg_reorderlevel", "pdg_safetystock", "pdg_stocktarget"].forEach(function (fname) {
            var a = formContext.getAttribute(fname);
            if (a) try { a.addOnChange(function () { self.validateReorderLevels(formContext); }); } catch (e) { }
        });
    },

    setupUomConversionValidation: function (formContext) {
        var self = this;
        ["pdg_primaryuomid", "pdg_secondaryuomid", "pdg_conversionfactor"].forEach(function (fname) {
            var a = formContext.getAttribute(fname);
            if (a) try { a.addOnChange(function () { self.validateUOMConversion(formContext); }); } catch (e) { }
        });
    },

    setupCustomsCategoryPercentage: function (formContext) {
        try {
            var pctCtrl = formContext.getControl("pdg_customscatpercentage");
            if (pctCtrl) pctCtrl.setDisabled(true);

            var catAttr = formContext.getAttribute("pdg_customscategory");
            if (!catAttr) return;

            var applyPercentage = function () {
                var v = catAttr.getValue();
                if (!v || !v[0] || !v[0].id) {
                    var pctAttr = formContext.getAttribute("pdg_customscatpercentage");
                    if (pctAttr) pctAttr.setValue(null);
                    return;
                }
                var catId = v[0].id.replace(/[{}]/g, "");
                Xrm.WebApi.retrieveRecord("pdg_customscategory", catId, "?$select=pdg_percentage,pdg_name").then(function (res) {
                    var pct = (typeof res.pdg_percentage === "number") ? res.pdg_percentage : null;
                    var pctAttr = formContext.getAttribute("pdg_customscatpercentage");
                    if (pctAttr) pctAttr.setValue(pct !== null ? pct.toString() : null);
                }).catch(function (e) {
                    console.warn("Could not load Customs Category percentage:", e);
                });
            };

            // Initial and change
            applyPercentage();
            try { catAttr.addOnChange(applyPercentage); } catch (e) {}
        } catch (e) {
            console.warn("Error setting up customs percentage binding:", e);
        }
    },

    setupTrackingMethodEvents: function (formContext) {
        var self = this;

        // Serial/Lot tracking mutual exclusion
        var serialAttr = formContext.getAttribute("pdg_serialcontrolled");
        var lotAttr = formContext.getAttribute("pdg_lotcontrolled");

        if (serialAttr) {
            try {
                serialAttr.addOnChange(function (ctx) {
                    self.onSerialControlledChange(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_serialcontrolled:", e);
            }
        }

        if (lotAttr) {
            try {
                lotAttr.addOnChange(function (ctx) {
                    self.onLotControlledChange(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_lotcontrolled:", e);
            }
        }

        // Expiry tracking
        var expiryAttr = formContext.getAttribute("pdg_expirytracking");
        if (expiryAttr) {
            try {
                expiryAttr.addOnChange(function (ctx) {
                    self.onExpiryTrackingChange(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_expirytracking:", e);
            }
        }
    },

    setupCostingEvents: function (formContext) {
        var self = this;

        // Cost changes for real-time analysis
        var costFields = ["pdg_publicprice", "pdg_standardcost"];

        costFields.forEach(function (fieldName) {
            var attribute = formContext.getAttribute(fieldName);
            if (attribute) {
                try {
                    attribute.addOnChange(function () {
                        self.displayCostAnalysis(formContext);
                    });
                } catch (e) {
                    console.warn("Could not add onChange to " + fieldName + ":", e);
                }
            }
        });

        // Costing method change
        var costingMethodAttr = formContext.getAttribute("pdg_costingmethod");
        if (costingMethodAttr) {
            try {
                costingMethodAttr.addOnChange(function (ctx) {
                    self.onCostingMethodChange(ctx);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_costingmethod:", e);
            }
        }
    },

    setupBarcodeEvents: function (formContext) {
        var self = this;

        // SKU change for barcode generation
        var skuAttr = formContext.getAttribute("pdg_sku");
        if (skuAttr) {
            try {
                skuAttr.addOnChange(function () {
                    self.generateBarcodeFromSKU(formContext);
                    self.updateBarcodeWebResources(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_sku:", e);
            }
        }

        // Barcode uniqueness validation
        var barcodeAttr = formContext.getAttribute("pdg_barcode");
        if (barcodeAttr) {
            try {
                barcodeAttr.addOnChange(function () {
                    self.validateBarcodeUniqueness(formContext);
                    self.updateBarcodeWebResources(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_barcode:", e);
            }
        }

        // Barcode scanning
        var barcodeScanAttr = formContext.getAttribute("pdg_barcode_scan");
        if (barcodeScanAttr) {
            try {
                barcodeScanAttr.addOnChange(function (ctx) {
                    self.handleBarcodeScanned(ctx);
                });
            } catch (e) {
                console.warn("Could not setup barcode scanning:", e);
            }
        }
    },

    // ========= Enhanced Initialization for Existing Records =========

    initializeExistingRecord: function (formContext) {
        var itemId = this.getRecordId(formContext);
        if (!itemId) return;

        var self = this;

        // Load all related data in parallel
        Promise.all([
            this.loadInventoryDetails(formContext),
            this.loadFinancialAnalytics(formContext),
            this.loadProductionStatus(formContext),
            this.loadSupplierPerformance(formContext),
            this.loadQualityMetrics(formContext),
            this.loadTransactionHistory(formContext)
        ]).then(function (results) {
            self.displayExecutiveSummary(formContext, results);
            self.updateAllWebResources(formContext, results);
            formContext.PDG_FormState.enhancedFeaturesLoaded = true;
            console.log("Enhanced features loaded for item:", itemId);
        }).catch(function (error) {
            console.error("Error loading enhanced features:", error);
            self.showWarningNotification(formContext, "Some enhanced features could not be loaded");
        });

        // Apply initial filtering for existing records
        this.applyInitialFilters(formContext);
    },

    applyInitialFilters: function (formContext) {
        try {
            var familyAttr = formContext.getAttribute("pdg_familyid");
            var subfamilyAttr = formContext.getAttribute("pdg_subfamilyid");

            if (familyAttr && familyAttr.getValue()) {
                this.filterSubfamily({ getFormContext: function () { return formContext; } });
            }
            if (subfamilyAttr && subfamilyAttr.getValue()) {
                this.filterCategory({ getFormContext: function () { return formContext; } });
            }
        } catch (e) {
            console.warn("Error in initial filtering setup:", e);
        }
    },

    // ========= Field Change Handlers =========

    onLockStatusChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var isLocked = formContext.getAttribute("pdg_islocked").getValue();

        if (isLocked) {
            Xrm.Navigation.openConfirmDialog({
                text: "Locking this item will prevent modifications to key fields. Are you sure?",
                title: "Lock Item Confirmation"
            }).then(function (result) {
                if (!result.confirmed) {
                    formContext.getAttribute("pdg_islocked").setValue(false);
                } else {
                    PDG.Item.lockItemFields(formContext);
                }
            });
        } else {
            this.unlockItemFields(formContext);
        }
    },

    lockItemFields: function (formContext) {
        var fieldsToLock = [
            "pdg_familyid", "pdg_subfamilyid", "pdg_category",
            "pdg_customscategory", "pdg_customscatpercentage", "pdg_cbfactor",
            "pdg_primaryuomid", "pdg_secondaryuomid", "pdg_conversionfactor"
        ];

        fieldsToLock.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (control) control.setDisabled(true);
        });

        this.showWarningNotification(formContext,
            "This item is locked - key fields cannot be modified", "item_locked");
    },

    unlockItemFields: function (formContext) {
        var fieldsToUnlock = [
            "pdg_familyid", "pdg_subfamilyid", "pdg_category",
            "pdg_customscategory", "pdg_customscatpercentage", "pdg_cbfactor",
            "pdg_primaryuomid", "pdg_secondaryuomid", "pdg_conversionfactor"
        ];

        fieldsToUnlock.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (control) control.setDisabled(false);
        });

        formContext.ui.clearFormNotification("item_locked");
    },

    onSerialControlledChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var serial = formContext.getAttribute("pdg_serialcontrolled").getValue();
        var lotAttr = formContext.getAttribute("pdg_lotcontrolled");

        if (serial && lotAttr && lotAttr.getValue()) {
            lotAttr.setValue(false);
            this.showInfoNotification(formContext,
                "Serial and Lot tracking cannot both be enabled. Lot tracking has been turned off.",
                "serial_lot_conflict");
        }

        if (serial) {
            this.showInfoNotification(formContext,
                "Serial tracking enabled - each unit will have unique serial number",
                "serial_info");
        } else {
            formContext.ui.clearFormNotification("serial_info");
        }
    },

    onLotControlledChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var lot = formContext.getAttribute("pdg_lotcontrolled").getValue();
        var serialAttr = formContext.getAttribute("pdg_serialcontrolled");

        if (lot && serialAttr && serialAttr.getValue()) {
            serialAttr.setValue(false);
            this.showInfoNotification(formContext,
                "Serial and Lot tracking cannot both be enabled. Serial tracking has been turned off.",
                "lot_serial_conflict");
        }

        if (lot) {
            this.showInfoNotification(formContext,
                "Lot tracking enabled - batches will be tracked with lot numbers",
                "lot_info");
        } else {
            formContext.ui.clearFormNotification("lot_info");
        }
    },

    onExpiryTrackingChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var expiryTracking = formContext.getAttribute("pdg_expirytracking").getValue();

        if (expiryTracking) {
            this.showInfoNotification(formContext,
                "Expiry tracking enabled - shelf life and expiration dates will be monitored",
                "expiry_hint");

            // Enable shelf life field
            var shelfLifeControl = formContext.getControl("pdg_shelflifedays");
            if (shelfLifeControl) {
                shelfLifeControl.setDisabled(false);
            }
        } else {
            formContext.ui.clearFormNotification("expiry_hint");

            // Clear and disable shelf life field
            var shelfLifeAttr = formContext.getAttribute("pdg_shelflifedays");
            if (shelfLifeAttr) {
                shelfLifeAttr.setValue(null);
            }
        }
    },

    onCostingMethodChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var costingMethod = formContext.getAttribute("pdg_costingmethod").getValue();

        formContext.ui.clearFormNotification("costing_info");

        if (costingMethod) {
            var methodText = formContext.getAttribute("pdg_costingmethod").getText();
            var methodInfo = {
                "100000000": "Standard cost remains fixed until manually updated",
                "100000001": "Moving average cost updates with each receipt",
                "100000002": "FIFO - First items received are first to be issued",
                "100000003": "LIFO - Last items received are first to be issued",
                "100000004": "Latest cost uses the most recent purchase price"
            };

            var infoText = methodInfo[costingMethod] || "Custom costing method";

            this.showInfoNotification(formContext,
                "Costing Method: " + methodText + " - " + infoText,
                "costing_info");
        }
    },

    // ========= Comprehensive Inventory Management =========

    loadInventoryDetails: function (formContext) {
        return new Promise(function (resolve, reject) {
            var itemId = PDG.Item.getRecordId(formContext);
            if (!itemId) {
                reject(new Error("No item ID available"));
                return;
            }

            // Load comprehensive inventory data
            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
                "?$select=pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity," +
                "pdg_costprice,pdg_averagecost,pdg_fifo,pdg_lastupdated," +
                "pdg_lastmovementdate,pdg_lastcountdate,pdg_goldweight,pdg_stoneweight," +
                "_pdg_warehouseid_value,_pdg_binid_value&" +
                "$filter=_pdg_itemid_value eq " + itemId + " and statecode eq 0"
            ).then(function (result) {
                var inventoryData = PDG.Item.processInventoryData(result.entities);
                PDG.Item.updateInventoryFields(formContext, inventoryData);
                PDG.Item.updateInventoryAnalyticsWebResource(formContext, inventoryData);
                resolve(inventoryData);
            }).catch(function (error) {
                console.error("Error loading inventory details:", error);
                reject(error);
            });
        });
    },

    processInventoryData: function (inventoryEntities) {
        var summary = {
            totalOnHand: 0,
            totalOnLine: 0,
            totalReserved: 0,
            totalValue: 0,
            totalGoldWeight: 0,
            totalStoneWeight: 0,
            locationCount: inventoryEntities.length,
            locations: [],
            lastMovementDate: null,
            lastCountDate: null,
            averageCost: 0,
            stockStatus: 'UNKNOWN'
        };

        inventoryEntities.forEach(function (inventory) {
            var onHand = inventory.pdg_onhandquantity || 0;
            var onLine = inventory.pdg_onlinequantity || 0;
            var reserved = inventory.pdg_reservedquantity || 0;
            var costPrice = inventory.pdg_costprice || 0;
            var goldWeight = inventory.pdg_goldweight || 0;
            var stoneWeight = inventory.pdg_stoneweight || 0;

            summary.totalOnHand += onHand;
            summary.totalOnLine += onLine;
            summary.totalReserved += reserved;
            summary.totalValue += (onHand * costPrice);
            summary.totalGoldWeight += goldWeight;
            summary.totalStoneWeight += stoneWeight;

            // Track latest dates
            if (inventory.pdg_lastmovementdate) {
                var moveDate = new Date(inventory.pdg_lastmovementdate);
                if (!summary.lastMovementDate || moveDate > summary.lastMovementDate) {
                    summary.lastMovementDate = moveDate;
                }
            }

            if (inventory.pdg_lastcountdate) {
                var countDate = new Date(inventory.pdg_lastcountdate);
                if (!summary.lastCountDate || countDate > summary.lastCountDate) {
                    summary.lastCountDate = countDate;
                }
            }

            // Build location details
            var warehouseFormatted = inventory["_pdg_warehouseid_value@OData.Community.Display.V1.FormattedValue"] || null;
            summary.locations.push({
                warehouseId: inventory._pdg_warehouseid_value,
                warehouseName: warehouseFormatted || "Unknown Warehouse",
                warehouseCode: "N/A",
                binId: inventory._pdg_binid_value,
                onHand: onHand,
                available: onLine,
                reserved: reserved,
                costPrice: costPrice,
                goldWeight: goldWeight,
                stoneWeight: stoneWeight,
                lastUpdated: inventory.pdg_lastupdated
            });
        });

        // Calculate weighted average cost
        if (summary.totalOnHand > 0) {
            summary.averageCost = summary.totalValue / summary.totalOnHand;
        }

        // Determine stock status
        if (summary.totalOnHand === 0) {
            summary.stockStatus = 'OUT_OF_STOCK';
        } else if (summary.totalOnHand <= this.Config.CRITICAL_STOCK_THRESHOLD) {
            summary.stockStatus = 'CRITICAL';
        } else if (summary.totalOnHand <= this.Config.LOW_STOCK_THRESHOLD) {
            summary.stockStatus = 'LOW';
        } else {
            summary.stockStatus = 'GOOD';
        }

        return summary;
    },

    updateInventoryFields: function (formContext, inventoryData) {
        try {
            // Update quantity on hand (total across all warehouses)
            if (formContext.getAttribute("pdg_quantityonhand")) {
                formContext.getAttribute("pdg_quantityonhand").setValue(inventoryData.totalOnHand);
            }

            // Update total quantity on hand (integer version)
            if (formContext.getAttribute("pdg_totalquantityonhand")) {
                formContext.getAttribute("pdg_totalquantityonhand").setValue(Math.floor(inventoryData.totalOnHand));
            }

            // Update last updated timestamp
            if (formContext.getAttribute("pdg_totalquantityonhand_date")) {
                formContext.getAttribute("pdg_totalquantityonhand_date").setValue(new Date());
            }

            // Update total value if field exists
            if (formContext.getAttribute("pdg_totalvalue") && inventoryData.totalValue) {
                formContext.getAttribute("pdg_totalvalue").setValue(inventoryData.totalValue);
            }

            // Update last physical count date if available
            if (formContext.getAttribute("pdg_lastphysicalcount") && inventoryData.lastCountDate) {
                formContext.getAttribute("pdg_lastphysicalcount").setValue(inventoryData.lastCountDate);
            }

            // Save inventory summary in form context for other functions
            formContext.PDG_InventorySummary = inventoryData;

        } catch (error) {
            console.error("Error updating inventory fields:", error);
        }
    },

    // ========= Financial Analytics =========

    loadFinancialAnalytics: function (formContext) {
        return new Promise(function (resolve, reject) {
            try {
                var financialData = PDG.Item.calculateFinancialMetrics(formContext);

                // Enhance with historical cost data
                PDG.Item.loadCostHistory(formContext).then(function (costHistory) {
                    financialData.costHistory = costHistory;
                    financialData.costTrend = PDG.Item.analyzeCostTrend(costHistory);
                    resolve(financialData);
                }).catch(function (error) {
                    // Still resolve with basic data if history fails
                    console.warn("Could not load cost history:", error);
                    resolve(financialData);
                });

            } catch (error) {
                reject(error);
            }
        });
    },

    calculateFinancialMetrics: function (formContext) {
        var publicPrice = this.getAttributeValue(formContext, "pdg_publicprice") || 0;
        var unitCost = this.getAttributeValue(formContext, "pdg_unitcost") || 0;
        var cogp = this.getAttributeValue(formContext, "pdg_cogp") || 0;
        var standardCost = this.getAttributeValue(formContext, "pdg_standardcost") || 0;
        var lastCost = this.getAttributeValue(formContext, "pdg_lastcost") || 0;
        var totalValue = this.getAttributeValue(formContext, "pdg_totalvalue") || 0;

        var metrics = {
            publicPrice: publicPrice,
            unitCost: unitCost,
            cogp: cogp,
            standardCost: standardCost,
            lastCost: lastCost,
            totalValue: totalValue,
            grossMargin: 0,
            grossMarginPercent: 0,
            markup: 0,
            markupPercent: 0,
            cogpMargin: 0,
            cogpMarginPercent: 0,
            costVariance: 0,
            costVariancePercent: 0,
            profitPerUnit: 0,
            status: 'UNKNOWN'
        };

        // Calculate margins and markup
        if (publicPrice > 0 && unitCost > 0) {
            metrics.grossMargin = publicPrice - unitCost;
            metrics.grossMarginPercent = (metrics.grossMargin / publicPrice) * 100;
            metrics.markup = publicPrice - unitCost;
            metrics.markupPercent = (metrics.markup / unitCost) * 100;
            metrics.profitPerUnit = metrics.grossMargin;

            // Determine margin status
            if (metrics.grossMarginPercent < this.Config.MARGIN_CRITICAL) {
                metrics.status = 'CRITICAL';
            } else if (metrics.grossMarginPercent < this.Config.MARGIN_WARNING) {
                metrics.status = 'WARNING';
            } else {
                metrics.status = 'HEALTHY';
            }
        }

        // COGP margin
        if (publicPrice > 0 && cogp > 0) {
            metrics.cogpMargin = publicPrice - cogp;
            metrics.cogpMarginPercent = (metrics.cogpMargin / publicPrice) * 100;
        }

        // Cost variance
        if (standardCost > 0 && unitCost > 0) {
            metrics.costVariance = unitCost - standardCost;
            metrics.costVariancePercent = (metrics.costVariance / standardCost) * 100;
        }

        return metrics;
    },

    displayCostAnalysis: function (formContext) {
        var financialMetrics = this.calculateFinancialMetrics(formContext);

        if (financialMetrics.publicPrice > 0 && financialMetrics.unitCost > 0) {
            var costAnalysis = "Cost Analysis - ";
            costAnalysis += "Gross Margin: " + financialMetrics.grossMarginPercent.toFixed(1) + "% | ";
            costAnalysis += "Markup: " + financialMetrics.markupPercent.toFixed(1) + "% | ";
            costAnalysis += "Profit per Unit: $" + financialMetrics.profitPerUnit.toFixed(2);

            // Add status-based messaging
            if (financialMetrics.status === 'CRITICAL') {
                costAnalysis += " - CRITICAL: Low margin - pricing review required!";
            } else if (financialMetrics.status === 'WARNING') {
                costAnalysis += " - WARNING: Below target margin - consider optimization";
            } else {
                costAnalysis += " - HEALTHY: Good margin maintained";
            }

            var notificationType = financialMetrics.status === 'CRITICAL' ? "ERROR" :
                (financialMetrics.status === 'WARNING' ? "WARNING" : "INFO");

            this.showNotification(formContext, costAnalysis, notificationType, "cost_analysis");
        }
    },

    // ========= Lookup Filtering Functions =========

    filterSubfamily: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var familyId = formContext.getAttribute("pdg_familyid").getValue();

        if (familyId) {
            // Clear subfamily and category when family changes
            if (executionContext.getEventSource && executionContext.getEventSource().getName() === "pdg_familyid") {
                formContext.getAttribute("pdg_subfamilyid").setValue(null);
                formContext.getAttribute("pdg_category").setValue(null);
                var categoryControl = formContext.getControl("pdg_category");
                if (categoryControl) {
                    try {
                        categoryControl.clearCustomFilter();
                    } catch (e) {
                        console.log("clearCustomFilter not available");
                    }
                }
            }

            var familyGuid = familyId[0].id.replace(/[{}]/g, "");
            var subfamilyControl = formContext.getControl("pdg_subfamilyid");

            if (subfamilyControl) {
                try {
                    subfamilyControl.addCustomFilter(
                        "<filter type='and'><condition attribute='pdg_family' operator='eq' value='" +
                        familyGuid + "' /></filter>"
                    );
                } catch (e) {
                    console.error("Error adding custom filter to subfamily:", e);
                }
            }

            // Auto-populate if only one subfamily exists
            this.autoPopulateSingleSubfamily(formContext, familyGuid);
        }
    },

    autoPopulateSingleSubfamily: function (formContext, familyGuid) {
        var self = this;
        Xrm.WebApi.retrieveMultipleRecords(
            "pdg_itemsubfamily",
            "?$select=pdg_itemsubfamilyid,pdg_name&$filter=_pdg_family_value eq '" + familyGuid + "'"
        ).then(function (result) {
            if (result.entities.length === 1) {
                var subfamily = result.entities[0];
                formContext.getAttribute("pdg_subfamilyid").setValue([{
                    id: subfamily.pdg_itemsubfamilyid,
                    name: subfamily.pdg_name,
                    entityType: "pdg_itemsubfamily"
                }]);

                // Trigger category filtering after setting subfamily
                self.filterCategory({ getFormContext: function () { return formContext; } });
            }
        }).catch(function (error) {
            console.error("Error retrieving subfamily:", error.message);
        });
    },

    filterCategory: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var subFamilyId = formContext.getAttribute("pdg_subfamilyid").getValue();

        if (subFamilyId) {
            // Clear category when subfamily changes
            if (executionContext.getEventSource && executionContext.getEventSource().getName() === "pdg_subfamilyid") {
                formContext.getAttribute("pdg_category").setValue(null);
            }

            var subFamilyGuid = subFamilyId[0].id.replace(/[{}]/g, "");
            var categoryControl = formContext.getControl("pdg_category");

            if (categoryControl) {
                try {
                    categoryControl.addCustomFilter(
                        "<filter type='and'><condition attribute='pdg_subfamilyid' operator='eq' value='" +
                        subFamilyGuid + "' /></filter>"
                    );
                } catch (e) {
                    console.error("Error adding custom filter to category:", e);
                }
            }

            // Auto-populate if only one category exists
            this.autoPopulateSingleCategory(formContext, subFamilyGuid);
        }
    },

    autoPopulateSingleCategory: function (formContext, subFamilyGuid) {
        Xrm.WebApi.retrieveMultipleRecords("pdg_itemcategory",
            "?$select=pdg_itemcategoryid,pdg_name&$filter=_pdg_subfamilyid_value eq '" + subFamilyGuid + "'"
        ).then(function (result) {
            if (result.entities.length === 1) {
                var category = result.entities[0];
                formContext.getAttribute("pdg_category").setValue([{
                    id: category.pdg_itemcategoryid,
                    name: category.pdg_name,
                    entityType: "pdg_itemcategory"
                }]);
            }
        }).catch(function (error) {
            console.error("Error retrieving Item Category:", error.message);
        });
    },

    // ========= Validation Functions =========

    validateCompleteRecord: function (formContext) {
        var errors = [];

        // Essential field validation
        if (!this.getAttributeValue(formContext, "pdg_name")) {
            errors.push("Item Name is required");
        }

        if (!this.getAttributeValue(formContext, "pdg_qrcode")) {
            errors.push("Item Code is required");
        }

        // Jewelry-specific validation
        var itemType = this.getAttributeValue(formContext, "pdg_itemtype");
        if (itemType === 100000001) { // Jewelry item
            if (!this.validateJewelryRequirements(formContext, errors)) {
                // Errors added by function
            }
        }

        // Financial validation
        if (!this.validateFinancialData(formContext, errors)) {
            // Errors added by function
        }

        // Weight validation
        if (!this.validateWeights(formContext, errors)) {
            // Errors added by function
        }

        // Show errors if any
        if (errors.length > 0) {
            var errorMessage = "Please correct the following issues:\n" + errors.join("\n");
            this.showErrorNotification(formContext, errorMessage);
            return false;
        }

        return true;
    },

    validateJewelryRequirements: function (formContext, errors) {
        var grossWeight = this.getAttributeValue(formContext, "pdg_grossweight");
        var netWeight = this.getAttributeValue(formContext, "pdg_netweight");
        var publicPrice = this.getAttributeValue(formContext, "pdg_publicprice");

        if (!grossWeight) {
            errors.push("Gross weight is required for jewelry items");
        }

        if (!netWeight) {
            errors.push("Net weight is required for jewelry items");
        }

        if (!publicPrice) {
            errors.push("Public price is required for jewelry items");
        }

        return errors.length === 0;
    },

    validateFinancialData: function (formContext, errors) {
        var publicPrice = this.getAttributeValue(formContext, "pdg_publicprice") || 0;
        var unitCost = this.getAttributeValue(formContext, "pdg_unitcost") || 0;

        if (publicPrice > 0 && unitCost > 0 && publicPrice <= unitCost) {
            errors.push("Public price should be higher than unit cost");
        }

        return true; // Non-blocking validation
    },

    validateWeights: function (formContext, errors) {
        var grossWeight = this.getAttributeValue(formContext, "pdg_grossweight");
        var netWeight = this.getAttributeValue(formContext, "pdg_netweight");

        if (grossWeight && netWeight && grossWeight < netWeight) {
            if (errors) {
                errors.push("Gross weight cannot be less than net weight");
            } else {
                this.showErrorNotification(formContext, "Gross weight cannot be less than net weight");
                return false;
            }
        }

        return true;
    },

    validateJewelryItem: function (formContext) {
        var itemType = this.getAttributeValue(formContext, "pdg_itemtype");
        var validationIssues = [];

        // Check if this is a jewelry item (assuming jewelry type = 100000001)
        if (itemType === 100000001) {
            var grossWeight = this.getAttributeValue(formContext, "pdg_grossweight");
            var netWeight = this.getAttributeValue(formContext, "pdg_netweight");
            var goldWeight = this.getAttributeValue(formContext, "pdg_goldweight");

            if (!grossWeight) validationIssues.push("Gross weight required for jewelry");
            if (!netWeight) validationIssues.push("Net weight required for jewelry");
            if (goldWeight !== null && !goldWeight) validationIssues.push("Gold weight recommended for jewelry");

            // Validate weight logic
            if (grossWeight && netWeight && grossWeight < netWeight) {
                validationIssues.push("Gross weight cannot be less than net weight");
            }

            // Validate pricing for jewelry
            var publicPrice = this.getAttributeValue(formContext, "pdg_publicprice");
            var unitCost = this.getAttributeValue(formContext, "pdg_unitcost");
            if (publicPrice && unitCost && publicPrice <= unitCost) {
                validationIssues.push("Public price should be higher than cost price");
            }
        }

        if (validationIssues.length > 0) {
            var message = "Jewelry Validation Issues:\n" + validationIssues.join("\n");
            this.showWarningNotification(formContext, message, "jewelry_validation");
        } else {
            formContext.ui.clearFormNotification("jewelry_validation");
        }
    },

    // ========= Calculations =========

    calculateVolume: function (formContext) {
        try {
            var length = Number(this.getAttributeValue(formContext, "pdg_length") || 0);
            var width = Number(this.getAttributeValue(formContext, "pdg_width") || 0);
            var height = Number(this.getAttributeValue(formContext, "pdg_height") || 0);

            if (length > 0 && width > 0 && height > 0) {
                var volume = length * width * height; // mm^3 if dimensions are mm
                var volumeAttr = formContext.getAttribute("pdg_volume");
                if (volumeAttr) {
                    try {
                        volumeAttr.setValue(volume);
                    } catch (e) {
                        console.warn("Could not set volume:", e);
                    }
                }

                // Auto-calc Dimensional Weight (kg): mm^3 -> cm^3 / divisor (5000)
                try {
                    var cm3 = volume / 1000.0; // 1 cm^3 = 1000 mm^3
                    var DIM_DIVISOR_CM3_PER_KG = 5000.0;
                    var dimWeightKg = cm3 / DIM_DIVISOR_CM3_PER_KG;
                    var dimAttr = formContext.getAttribute("pdg_dimensionalweight");
                    if (dimAttr) { dimAttr.setValue(Number(dimWeightKg.toFixed(3))); }
                } catch (e) { }

                var displayVolume = volume;
                var unit = "mm³";
                if (volume > 1000000) {
                    displayVolume = (volume / 1000000).toFixed(2);
                    unit = "cm³";
                }
                if (displayVolume > 1000) {
                    displayVolume = (displayVolume / 1000).toFixed(2);
                    unit = "L";
                }

                this.showInfoNotification(formContext,
                    "Volume calculated: " + displayVolume + " " + unit, "volume_calc");
            } else {
                var volumeAttr2 = formContext.getAttribute("pdg_volume");
                if (volumeAttr2) {
                    try {
                        volumeAttr2.setValue(0);
                    } catch (e) {
                        console.warn("Could not clear volume:", e);
                    }
                }
                var dimAttr2 = formContext.getAttribute("pdg_dimensionalweight");
                if (dimAttr2) { try { dimAttr2.setValue(null); } catch (e) {} }
                formContext.ui.clearFormNotification("volume_calc");
            }
        } catch (e) {
            console.error("Error calculating volume:", e);
        }
    },

    calculateTotalWeight: function (formContext) {
        var goldWeight = Number(this.getAttributeValue(formContext, "pdg_goldweight") || 0);
        var stoneWeight = Number(this.getAttributeValue(formContext, "pdg_stoneweight") || 0);
        var totalWeight = goldWeight + stoneWeight;

        // Update net weight if it's less than calculated total
        var netWeightAttr = formContext.getAttribute("pdg_netweight");
        if (netWeightAttr && totalWeight > 0) {
            var currentNetWeight = netWeightAttr.getValue() || 0;
            if (currentNetWeight < totalWeight) {
                netWeightAttr.setValue(totalWeight);
                this.showInfoNotification(formContext,
                    "Net weight updated based on gold + stone weights: " + totalWeight.toFixed(3) + "g",
                    "weight_calculated");
            }
        }
    },

    calculateAllComputedFields: function (formContext) {
        this.calculateVolume(formContext);
        this.calculateTotalWeight(formContext);
        this.calculateFinancialMetrics(formContext);
    },

    // ========= Barcode Management =========

    generateIntelligentBarcode: function (formContext) {
        var family = this.getAttributeValue(formContext, "pdg_familyid");
        var itemCode = this.getAttributeValue(formContext, "pdg_qrcode");
        var currentBarcode = this.getAttributeValue(formContext, "pdg_barcode");

        if (itemCode && !currentBarcode) {
            var prefix = "";

            // Create intelligent prefix based on jewelry type
            if (family && family[0].name) {
                var familyName = family[0].name.toUpperCase();
                if (familyName.includes("RING")) prefix = "RG";
                else if (familyName.includes("NECKLACE")) prefix = "NK";
                else if (familyName.includes("BRACELET")) prefix = "BR";
                else if (familyName.includes("EARRING")) prefix = "ER";
                else if (familyName.includes("PENDANT")) prefix = "PD";
                else if (familyName.includes("CHAIN")) prefix = "CH";
                else prefix = familyName.substring(0, 2);
            }

            var timestamp = Date.now().toString().slice(-6);
            var cleanItemCode = itemCode.replace(/[^A-Z0-9]/g, '').substring(0, 8);
            var generatedBarcode = prefix + cleanItemCode + timestamp;

            formContext.getAttribute("pdg_barcode").setValue(generatedBarcode);
            this.showInfoNotification(formContext,
                "Intelligent barcode generated: " + generatedBarcode,
                "barcode_generated");
        }
    },

    generateBarcodeFromSKU: function (formContext) {
        var sku = this.getAttributeValue(formContext, "pdg_sku");
        var currentBarcode = this.getAttributeValue(formContext, "pdg_barcode");

        if (sku && !currentBarcode) {
            var generatedBarcode = sku + "-" + Date.now().toString().slice(-6);
            formContext.getAttribute("pdg_barcode").setValue(generatedBarcode);
            this.showInfoNotification(formContext,
                "Barcode auto-generated: " + generatedBarcode,
                "barcode_generated");
        }
    },

    validateBarcodeUniqueness: function (formContext) {
        var barcode = this.getAttributeValue(formContext, "pdg_barcode");
        if (!barcode) return true;

        var currentRecordId = formContext.data.entity.getId();
        var query = "?$select=pdg_inventoryitemid&$filter=pdg_barcode eq '" + barcode + "' and statecode eq 0";

        if (currentRecordId) {
            var cleanId = currentRecordId.replace(/[{}]/g, "");
            query += " and pdg_inventoryitemid ne " + cleanId;
        }

        Xrm.WebApi.retrieveMultipleRecords("pdg_inventoryitem", query)
            .then(function (result) {
                if (result.entities.length > 0) {
                    PDG.Item.showErrorNotification(formContext,
                        "This barcode is already assigned to another item", "barcode_duplicate");
                } else {
                    formContext.ui.clearFormNotification("barcode_duplicate");
                }
            })
            .catch(function (error) {
                console.error("Barcode validation error:", error);
            });
    },

    handleBarcodeScanned: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var scanAttr = formContext.getAttribute("pdg_barcode_scan");
        var barcode = scanAttr ? scanAttr.getValue() : null;

        if (!barcode || barcode.trim() === '') return;

        // Clear previous notifications
        formContext.ui.clearFormNotification("barcode_scan_result");

        // Validate against current item's barcodes
        var currentBarcode = this.getAttributeValue(formContext, "pdg_barcode");
        var currentSupplierBarcode = this.getAttributeValue(formContext, "pdg_supplieritemcode");

        if (barcode === currentBarcode || barcode === currentSupplierBarcode) {
            this.showInfoNotification(formContext,
                "Barcode verified: " + barcode + " matches this item", "barcode_scan_result");
        } else {
            this.showWarningNotification(formContext,
                "Barcode mismatch: " + barcode + " does not match this item's barcodes", "barcode_scan_result");
        }

        // Clear the scan field
        if (scanAttr) {
            try {
                scanAttr.setValue(null);
            } catch (e) {
                console.warn("Could not clear barcode scan field:", e);
            }
        }
    },

    // ========= WebResource Management =========

    initializeWebResources: function (formContext) {
        var webResources = [
            { id: this.Config.WR_IDS.stockDashboard, data: {} },
            // Do not push empty payloads; these are updated with real data later
            { id: this.Config.WR_IDS.inventoryAnalytics, data: {} }
        ];

        var self = this;
        webResources.forEach(function (wr) {
            try {
                self.setWebResourceData(formContext, wr.id, wr.data);
            } catch (error) {
                console.warn("Could not initialize web resource:", wr.id, error);
            }
        });

        // Initialize charts/alerts with current values
        try { this.updateMarginWebResource(formContext); } catch (e) {}
        try { this.updateAlertsWebResource(formContext, formContext.PDG_InventorySummary || null); } catch (e) {}
    },

    updateBarcodeWebResources: function (formContext) {
        try {
            var itemDetails = formContext._itemDetails || {};
            var barcodeVal = itemDetails.barcode || this.getAttributeValue(formContext, "pdg_barcode") ||
                this.getAttributeValue(formContext, "pdg_sku") || "";
            var qrVal = itemDetails.itemCode || this.getAttributeValue(formContext, "pdg_qrcode") ||
                this.getAttributeValue(formContext, "pdg_sku") || "";

            this.setWebResourceData(formContext, this.Config.WR_IDS.itemBarcode, "pdg_barcode", barcodeVal);
            this.setWebResourceData(formContext, this.Config.WR_IDS.itemQR, "pdg_qr", qrVal);
        } catch (e) {
            console.warn("Error updating barcode web resources:", e);
        }
    },

    setWebResourceData: function (formContext, webResourceId, dataOrKey, maybeValue) {
        try {
            var control = formContext.getControl(webResourceId);
            if (!control || typeof control.setSrc !== "function") return;

            var payload;
            if (typeof maybeValue !== "undefined") {
                var obj = {};
                obj[dataOrKey] = maybeValue;
                payload = obj;
            } else {
                payload = (typeof dataOrKey === "undefined") ? {} : dataOrKey;
            }

            var encodedData = encodeURIComponent(JSON.stringify(payload));
            var currentSrc = (typeof control.getSrc === "function") ? control.getSrc() : null;
            if (!currentSrc || currentSrc.length === 0) {
                // If form designer configured a Url, keep it; otherwise we cannot resolve logical name here.
                // In that case, just return without overriding to an incorrect id-based path.
                return;
            }

            // Preserve base src and append/replace data param
            var base = currentSrc.split("?")[0];
            var newSrc = base + "?data=" + encodedData;
            control.setSrc(newSrc);
        } catch (error) {
            console.warn("Could not set web resource data for:", webResourceId, error);
        }
    },

    // Push financial metrics and alerts payloads to web resources
    updateMarginWebResource: function (formContext) {
        try {
            var m = this.calculateFinancialMetrics(formContext);
            var payload = {
                publicPrice: m.publicPrice || 0,
                unitCost: m.unitCost || 0,
                cogp: m.cogp || 0,
                standardCost: m.standardCost || 0,
                lastCost: this.getAttributeValue(formContext, "pdg_lastcost") || 0,
                grossMargin: m.grossMarginPercent || 0,
                grossMarginPercent: m.grossMarginPercent || 0,
                markup: m.markup || 0,
                markupPercent: m.markupPercent || 0,
                cogpMarginPercent: m.cogpMarginPercent || 0,
                costVariancePercent: m.costVariancePercent || 0,
                profitPerUnit: m.profitPerUnit || 0,
                status: m.status || 'UNKNOWN'
            };
            this.setWebResourceData(formContext, this.Config.WR_IDS.marginAnalysis, payload);
        } catch (e) { console.warn("updateMarginWebResource", e); }
    },

    updateAlertsWebResource: function (formContext, inventoryData) {
        try {
            var payload = {
                itemId: this.getRecordId(formContext),
                itemName: this.getAttributeValue(formContext, "pdg_name") || '',
                stockLevel: (inventoryData && inventoryData.totalOnHand) || 0,
                reorderLevel: this.getAttributeValue(formContext, "pdg_reorderlevel") || 0,
                safetyStock: this.getAttributeValue(formContext, "pdg_safetystock") || 0,
                grossMargin: (function(){ var m = PDG.Item.calculateFinancialMetrics(formContext); return m.grossMarginPercent || 0; })(),
                pendingQuality: 0,
                hasActiveProduction: false,
                onTimeDelivery: 100,
                lastCountDate: (inventoryData && inventoryData.lastCountDate) || null
            };
            this.setWebResourceData(formContext, this.Config.WR_IDS.alertsPanel, payload);
        } catch (e) { console.warn("updateAlertsWebResource", e); }
    },

    // ========= Real-Time Updates =========

    setupRealTimeUpdates: function (formContext) {
        if (formContext.ui.getFormType() === 1) return; // Skip for new records

        var self = this;
        // Setup inventory refresh
        var inventoryInterval = setInterval(function () {
            if (!formContext.data.entity.getIsDirty()) {
                self.refreshInventoryData(formContext);
            }
        }, this.Config.REFRESH_INTERVAL);

        formContext.PDG_FormState.refreshIntervals.push(inventoryInterval);

        // Setup financial metrics refresh
        var financialInterval = setInterval(function () {
            self.refreshFinancialMetrics(formContext);
        }, this.Config.REFRESH_INTERVAL * 2);

        formContext.PDG_FormState.refreshIntervals.push(financialInterval);
    },

    refreshInventoryData: function (formContext) {
        // Refresh inventory data without blocking UI
        this.loadInventoryDetails(formContext)
            .then(function (inventoryData) {
                console.log("Inventory data refreshed automatically");
            })
            .catch(function (error) {
                console.warn("Auto-refresh inventory error:", error);
            });
    },

    refreshFinancialMetrics: function (formContext) {
        try {
            this.displayCostAnalysis(formContext);
        } catch (error) {
            console.warn("Auto-refresh financial metrics error:", error);
        }
    },

    // ========= Stub Functions for Missing Features =========

    loadProductionStatus: function (formContext) {
        return Promise.resolve({ hasData: false });
    },

    loadSupplierPerformance: function (formContext) {
        return Promise.resolve({ hasData: false });
    },

    loadQualityMetrics: function (formContext) {
        return Promise.resolve({ hasData: false });
    },

    loadTransactionHistory: function (formContext) {
        return Promise.resolve({ hasData: false });
    },

    loadCostHistory: function (formContext) {
        return Promise.resolve([]);
    },

    analyzeCostTrend: function (costHistory) {
        return 'STABLE';
    },

    displayExecutiveSummary: function (formContext, results) {
        // Placeholder for executive summary display
    },

    updateAllWebResources: function (formContext, results) {
        this.updateBarcodeWebResources(formContext);

        // Push inventory summary to stock dashboard if present in results[0]
        try {
            var inventorySummary = results && results[0];
            if (inventorySummary && typeof inventorySummary === 'object') {
                this.updateInventoryAnalyticsWebResource(formContext, inventorySummary);
                this.updateQuickActionsWebResource(formContext, inventorySummary);
                this.updateAlertsWebResource(formContext, inventorySummary);
            }
            // Always refresh margin panel from current form values
            this.updateMarginWebResource(formContext);
        } catch (e) {
            console.warn("Could not update stock dashboard:", e);
        }
    },

    updateInventoryAnalyticsWebResource: function (formContext, inventoryData) {
        try {
            if (!inventoryData) return;

            var payload = {
                totalOnHand: inventoryData.totalOnHand || 0,
                totalValue: inventoryData.totalValue || 0,
                lastMovementDate: inventoryData.lastMovementDate || null,
                locationCount: (inventoryData.locationCount != null) ? inventoryData.locationCount : (inventoryData.locations ? inventoryData.locations.length : 0),
                stockStatus: inventoryData.stockStatus || 'UNKNOWN',
                reorderLevel: (formContext.getAttribute("pdg_reorderlevel") && formContext.getAttribute("pdg_reorderlevel").getValue()) || 0,
                locations: []
            };

            if (Array.isArray(inventoryData.locations)) {
                payload.locations = inventoryData.locations.map(function (loc) {
                    return { name: loc.warehouseName || 'Warehouse', quantity: loc.onHand || 0 };
                });
            }

            this.setWebResourceData(formContext, this.Config.WR_IDS.stockDashboard, payload);
        } catch (e) {
            console.warn("Error updating inventory webresource:", e);
        }
    },

    updateQuickActionsWebResource: function (formContext, inventoryData) {
        try {
            var itemId = this.getRecordId(formContext);
            var stockLevel = inventoryData && inventoryData.totalOnHand || 0;
            var reorderLevel = (formContext.getAttribute("pdg_reorderlevel") && formContext.getAttribute("pdg_reorderlevel").getValue()) || 0;
            var lastCountDate = inventoryData && inventoryData.lastCountDate || null;

            var payload = {
                itemId: itemId,
                stockLevel: stockLevel,
                reorderLevel: reorderLevel,
                lastCountDate: lastCountDate,
                hasActiveProduction: false,
                pendingQuality: 0,
                availableActions: ['reorder','receive','transfer','count','production','quality']
            };

            this.setWebResourceData(formContext, this.Config.WR_IDS.quickActions, payload);
        } catch (e) {
            console.warn("Error updating quick actions webresource:", e);
        }
    },

    setupAccessibilityFeatures: function (formContext) {
        // Placeholder for accessibility features
    },

    logSaveAction: function (formContext) {
        // Placeholder for save action logging
    },

    // ========= Utility Functions =========

    getRecordId: function (formContext) {
        try {
            var id = formContext.data.entity.getId();
            return id ? id.replace(/[{}]/g, '') : null;
        } catch (error) {
            return null;
        }
    },

    getAttributeValue: function (formContext, attributeName) {
        try {
            var attribute = formContext.getAttribute(attributeName);
            return attribute ? attribute.getValue() : null;
        } catch (error) {
            return null;
        }
    },

    showErrorNotification: function (formContext, message, id) {
        try {
            formContext.ui.setFormNotification(message, "ERROR", id || "pdg_error_" + Date.now());
        } catch (error) {
            console.error("Could not show error notification:", error);
        }
    },

    showWarningNotification: function (formContext, message, id) {
        try {
            formContext.ui.setFormNotification(message, "WARNING", id || "pdg_warning_" + Date.now());
        } catch (error) {
            console.error("Could not show warning notification:", error);
        }
    },

    showInfoNotification: function (formContext, message, id) {
        try {
            formContext.ui.setFormNotification(message, "INFO", id || "pdg_info_" + Date.now());
        } catch (error) {
            console.error("Could not show info notification:", error);
        }
    },

    showNotification: function (formContext, message, level, id) {
        try {
            formContext.ui.setFormNotification(message, level || "INFO", id || "pdg_note_" + Date.now());
        } catch (error) {
            console.error("Could not show notification:", error);
        }
    }
};

// ========= Global Functions for Ribbon Integration =========

// Ribbon button functions
PDG.Item.recalculateInventory = function (primaryControl) {
    var formContext = primaryControl || Xrm.Page;
    var itemId = formContext.data.entity.getId();

    if (!itemId) {
        Xrm.Navigation.openAlertDialog({
            text: "Please save the item first before recalculating inventory.",
            title: "Save Required"
        });
        return;
    }

    Xrm.Utility.showProgressIndicator("Recalculating inventory across all warehouses...");

    // Refresh the inventory display
    PDG.Item.loadInventoryDetails(formContext)
        .then(function () {
            Xrm.Utility.closeProgressIndicator();
            return formContext.data.refresh(false);
        })
        .then(function () {
            Xrm.Navigation.openAlertDialog({
                text: "Inventory data has been refreshed and recalculated.",
                title: "Refresh Complete"
            });
        })
        .catch(function (error) {
            Xrm.Utility.closeProgressIndicator();
            console.error("Error recalculating inventory:", error);
        });
};

console.log("Enhanced PDG Item Form JavaScript loaded successfully");



// Enhanced Financial Overview Functions for CJMSS Item Form
var FinancialOverview = {
    displayAdvancedCostAnalysis: function (formContext) {
        try { formContext.ui.clearFormNotification("enhanced_financial_analysis"); } catch(e){}
        var get = function(n){ try{ var a=formContext.getAttribute(n); return a?a.getValue():null; }catch(e){ return null; } };
        var unitCost = Number(get("pdg_unitcost") || 0);
        var cogp = Number(get("pdg_cogp") || 0);
        var publicPrice = Number(get("pdg_publicprice") || 0);
        var standardCost = Number(get("pdg_standardcost") || 0);
        var lastCost = Number(get("pdg_lastcost") || 0);
        var replacementCost = Number(get("pdg_replacementcost") || 0);
        var averageCost = Number(get("pdg_averagecost") || 0);
        var movingAverageCost = Number(get("pdg_movingaveragecost") || 0);
        var maximumDiscount = Number(get("pdg_maximumdiscount") || 0);

        if (unitCost > 0 && publicPrice > 0) {
            var margin = ((publicPrice - unitCost) / publicPrice * 100);
            var markup = ((publicPrice - unitCost) / unitCost * 100);
            var profitPerUnit = publicPrice - unitCost;
            var breakEvenPrice = unitCost / (1 - 0.45);
            var priceElasticity = this.calculatePriceElasticity(formContext);
            var competitorAnalysis = this.getCompetitorPricing(formContext);

            var standardVariance = standardCost > 0 ? ((unitCost - standardCost) / standardCost * 100) : 0;
            var lastCostChange = lastCost > 0 ? ((unitCost - lastCost) / lastCost * 100) : 0;
            var avgCostVariance = averageCost > 0 ? ((unitCost - averageCost) / averageCost * 100) : 0;

            var costAnalysis = "💰 ENHANCED FINANCIAL ANALYSIS\n\n";
            costAnalysis += "📊 PROFITABILITY METRICS\n";
            costAnalysis += "• Gross Margin: " + margin.toFixed(1) + "%\n";
            costAnalysis += "• Markup: " + markup.toFixed(1) + "%\n";
            costAnalysis += "• Profit per Unit: " + profitPerUnit.toFixed(2) + "\n";
            costAnalysis += "• Break-even Price: " + breakEvenPrice.toFixed(2) + "\n\n";

            costAnalysis += "🔍 COST VARIANCE ANALYSIS\n";
            if (standardCost > 0) { costAnalysis += "• Standard Cost Variance: " + standardVariance.toFixed(1) + "%\n"; }
            if (lastCost > 0) { costAnalysis += "• Cost Change vs Last: " + lastCostChange.toFixed(1) + "%\n"; }
            if (averageCost > 0) { costAnalysis += "• Average Cost Variance: " + avgCostVariance.toFixed(1) + "%\n"; }
            if (movingAverageCost > 0) { var movVar = ((unitCost - movingAverageCost)/movingAverageCost*100); costAnalysis += "• Moving Avg Cost Variance: " + movVar.toFixed(1) + "%\n"; }

            if (cogp > 0) {
                var cogpMargin = ((publicPrice - cogp) / publicPrice * 100);
                costAnalysis += "• COGP Margin: " + cogpMargin.toFixed(1) + "%\n";
                var cogpEfficiency = ((cogp - unitCost) / cogp * 100);
                costAnalysis += "• Production Efficiency: " + cogpEfficiency.toFixed(1) + "%\n";
            }
            if (replacementCost > 0) {
                var replVar = ((unitCost - replacementCost)/replacementCost*100);
                costAnalysis += "• Replacement Cost Variance: " + replVar.toFixed(1) + "%\n";
            }
            costAnalysis += "\n";

            costAnalysis += "🎯 MARKET INTELLIGENCE\n";
            costAnalysis += "• Price Elasticity: " + priceElasticity + "\n";
            costAnalysis += "• Market Position: " + this.getMarketPosition(margin) + "\n";
            if (maximumDiscount > 0) {
                var minPriceAfterDiscount = publicPrice * (1 - maximumDiscount / 100);
                var discountedMargin = ((minPriceAfterDiscount - unitCost) / minPriceAfterDiscount * 100);
                costAnalysis += "• Min Margin (Max Discount): " + discountedMargin.toFixed(1) + "%\n";
            }
            costAnalysis += "\n";

            var alerts = this.generateSmartAlerts(margin, standardVariance, lastCostChange, publicPrice, unitCost);
            costAnalysis += alerts;

            var recommendations = self.generateRecommendations ? self.generateRecommendations(margin, unitCost, publicPrice, breakEvenPrice) : FinancialOverview.generateRecommendations(margin, unitCost, publicPrice, breakEvenPrice);
            costAnalysis += recommendations;

            var notificationType = margin < 0 ? "ERROR" : (margin < 20 ? "WARNING" : "INFO");
            try { formContext.ui.setFormNotification(costAnalysis, notificationType, "enhanced_financial_analysis"); } catch(e){}
        } else {
            try { formContext.ui.clearFormNotification("enhanced_financial_analysis"); } catch(e){}
        }
    },

    generateSmartAlerts: function(margin, standardVariance, lastCostChange, publicPrice, unitCost) {
        var alerts = "🚨 SMART ALERTS\n";
        var hasAlerts = false;
        if (margin < 0) { alerts += "🔴 CRITICAL: Selling below cost! Loss of " + (unitCost - publicPrice).toFixed(2) + " per unit\n"; hasAlerts = true; }
        else if (margin < 10) { alerts += "🟠 HIGH RISK: Extremely low margin - immediate review required\n"; hasAlerts = true; }
        else if (margin < 20) { alerts += "🟡 WARNING: Below target margin - pricing optimization needed\n"; hasAlerts = true; }
        if (Math.abs(standardVariance) > 15) { alerts += "⚠️ COST ALERT: Significant variance from standard cost (" + standardVariance.toFixed(1) + "%)\n"; hasAlerts = true; }
        if (Math.abs(lastCostChange) > 10) { var direction = lastCostChange > 0 ? "increased" : "decreased"; alerts += "📈 COST TREND: Unit cost " + direction + " by " + Math.abs(lastCostChange).toFixed(1) + "% since last order\n"; hasAlerts = true; }
        if (margin >= 35 && margin <= 55) { alerts += "✅ EXCELLENT: Healthy margin within optimal range\n"; hasAlerts = true; }
        if (!hasAlerts) { alerts += "✅ ALL GOOD: No critical issues detected\n"; }
        return alerts + "\n";
    },

    generateRecommendations: function(margin, unitCost, publicPrice, breakEvenPrice) {
        var recommendations = "💡 SMART RECOMMENDATIONS\n";
        if (margin < 0) {
            recommendations += "• URGENT: Increase price to minimum " + breakEvenPrice.toFixed(2) + " for break-even\n";
            recommendations += "• STRATEGY: Consider premium positioning or value-add services\n";
        } else if (margin < 20) {
            recommendations += "• PRICING: Consider 15-25% price increase to improve profitability\n";
            recommendations += "• COST: Review supplier negotiations for better rates\n";
        } else if (margin > 60) {
            recommendations += "• OPPORTUNITY: High margins suggest potential for market expansion\n";
            recommendations += "• COMPETITIVE: Monitor competitor pricing for market share growth\n";
        }
        recommendations += "• OPTIMIZATION: Bulk purchasing could reduce unit costs by 3-8%\n";
        recommendations += "• MONITORING: Set up automated price alerts for cost fluctuations\n";
        return recommendations + "\n";
    },

    calculatePriceElasticity: function(formContext) {
        try{
            var category = formContext.getAttribute("pdg_category").getValue();
            if (category && category[0]) {
                var categoryName = (category[0].name || '').toLowerCase();
                if (categoryName.indexOf("diamond")>=0 || categoryName.indexOf("gold")>=0) return "Low (Luxury item)";
                if (categoryName.indexOf("silver")>=0 || categoryName.indexOf("fashion")>=0) return "Medium (Fashion item)";
            }
        }catch(e){}
        return "Medium";
    },

    getMarketPosition: function(margin) {
        if (margin < 0) return "Below Market (Loss-making)";
        if (margin < 15) return "Low-End Market";
        if (margin < 30) return "Mid-Market";
        if (margin < 50) return "Premium Market";
        return "Luxury Market";
    },

    getCompetitorPricing: function(formContext) {
        return { averageMarketPrice: 0, competitorCount: 0, marketPosition: "Unknown" };
    },

    displayCurrencyAnalysis: function(formContext) {
        try { formContext.ui.clearFormNotification('currency_analysis'); } catch(e){}
        var get = function(n){ try{ var a=formContext.getAttribute(n); return a?a.getValue():null; }catch(e){ return null; } };
        var currency = get("transactioncurrencyid");
        var exchangeRate = Number(get("pdg_exchangerate") || 1);
        if (currency && currency[0]) {
            var currencyCode = currency[0].name;
            var analysis = "💱 CURRENCY ANALYSIS\n\n";
            analysis += "• Base Currency: " + currencyCode + "\n";
            analysis += "• Exchange Rate: " + (isFinite(exchangeRate)? exchangeRate.toFixed(6): 'N/A') + "\n";
            if (exchangeRate && exchangeRate !== 1) {
                analysis += "• Currency Risk: Monitor exchange rate fluctuations\n";
                analysis += "• Hedging: Consider currency hedging for large orders\n";
            }
            try { formContext.ui.setFormNotification(analysis, 'INFO', 'currency_analysis'); } catch(e){}
        }
    },

    displayInventoryValueAnalysis: function(formContext) {
        try { formContext.ui.clearFormNotification('inventory_value_analysis'); } catch(e){}
        var entity = formContext.data && formContext.data.entity;
        if (!entity || !entity.getId || !entity.getId()) return;
        var itemId = entity.getId().replace(/[{}]/g, '');
        Xrm.WebApi.retrieveMultipleRecords('pdg_inventory', "?$select=pdg_onhandquantity,pdg_costprice,pdg_publicprice,pdg_warehouseid&$filter=_pdg_itemid_value eq " + itemId).then(function(result) {
            var totalValue = 0, totalCost = 0, totalQuantity = 0;
            var locationCount = result.entities.length;
            (result.entities||[]).forEach(function(inv){
                var qty = Number(inv.pdg_onhandquantity || 0);
                var cost = Number(inv.pdg_costprice || 0);
                var price = Number(inv.pdg_publicprice || 0);
                totalQuantity += qty;
                totalCost += (qty * cost);
                totalValue += (qty * price);
            });
            var potentialProfit = totalValue - totalCost;
            var averageMargin = totalValue > 0 ? ((potentialProfit / totalValue) * 100) : 0;
            var msg = '📦 INVENTORY VALUE ANALYSIS\n\n';
            msg += '• Total Quantity: ' + totalQuantity + ' units\n';
            msg += '• Total Cost Value: ' + totalCost.toFixed(2) + '\n';
            msg += '• Total Retail Value: ' + totalValue.toFixed(2) + '\n';
            msg += '• Potential Profit: ' + potentialProfit.toFixed(2) + '\n';
            msg += '• Average Margin: ' + averageMargin.toFixed(1) + '%\n';
            msg += '• Storage Locations: ' + locationCount + '\n';
            try { formContext.ui.setFormNotification(msg, 'INFO', 'inventory_value_analysis'); } catch(e){}
        }).catch(function(err){ console.warn('Inventory analysis error', err); });
    }
};
    // ---------- Inventory totals (authoritative from pdg_inventory) ----------
    api.recalcItemTotalsFromInventory = function (fc, options) {
        options = options || {};
        var persist = !!options.persist;
        var showMismatch = (options.showMismatch !== false); // default true
        var entity = fc.data && fc.data.entity;
        if (!entity || !entity.getId || !entity.getId()) return;
        var itemId = entity.getId().replace(/[{}]/g,'');

        var q = "?$select=pdg_onhandquantity,pdg_costprice,pdg_publicprice&$filter=_pdg_itemid_value eq " + itemId;
        return Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", q).then(function (res) {
            var totalQty = 0, totalCost = 0, totalRetail = 0;
            (res.entities||[]).forEach(function(inv){
                var qty = Number(inv.pdg_onhandquantity || 0);
                var cost = Number(inv.pdg_costprice || 0);
                var price = Number(inv.pdg_publicprice || 0);
                totalQty += qty;
                totalCost += qty * cost;
                totalRetail += qty * price;
            });
            api._totalsCache = { quantity: totalQty, costValue: totalCost, retailValue: totalRetail, ts: Date.now() };

            // Decide basis for pdg_totalvalue: prefer retail if present, else cost
            var basisValue = totalRetail > 0 ? totalRetail : totalCost;

            // Update UI fields (read-only controls will still reflect attribute values)
            try { fc.getAttribute("pdg_quantityonhand").setValue(totalQty); } catch(e){}
            try { fc.getAttribute("pdg_totalvalue").setValue(basisValue); } catch(e){}

            if (showMismatch) api.detectAndWarnMismatch(fc, basisValue, totalQty);
            if (persist) api.applyTotalsToAttributes(fc); // ensure attributes are set before save
            return api._totalsCache;
        }).catch(function (e){ console.warn("Totals recalc error", e); });
    };

    api.applyTotalsToAttributes = function (fc) {
        if (!api._totalsCache) return;
        try { var aQ = fc.getAttribute("pdg_quantityonhand"); if (aQ) aQ.setValue(api._totalsCache.quantity); } catch(e){}
        try { var aV = fc.getAttribute("pdg_totalvalue"); if (aV) aV.setValue(api._totalsCache.retailValue>0? api._totalsCache.retailValue : api._totalsCache.costValue); } catch(e){}
    };

    api.detectAndWarnMismatch = function (fc, computedTotalValue, computedQty) {
        var curQty = 0, curVal = 0;
        try { curQty = Number((fc.getAttribute("pdg_quantityonhand")||{}).getValue() || 0); } catch(e){}
        try { curVal = Number((fc.getAttribute("pdg_totalvalue")||{}).getValue() || 0); } catch(e){}
        var qtyDiff = Math.abs(curQty - computedQty);
        var valDiff = Math.abs(curVal - computedTotalValue);
        // tolerances
        var qtyMismatch = qtyDiff > 0.0001;
        var valMismatch = valDiff > 0.01;

        try { fc.ui.clearFormNotification("totals_mismatch"); } catch(e){}
        if (qtyMismatch || valMismatch) {
            var msg = "Inventory totals mismatch detected. Expected Qty: " + computedQty + ", Current: " + curQty +
                      " | Expected Total Value: " + computedTotalValue.toFixed(2) + ", Current: " + curVal.toFixed(2) +
                      ". Values will be corrected on save.";
            try { fc.ui.setFormNotification(msg, "WARNING", "totals_mismatch"); } catch(e){}
        }
    };

    api.wireSubgridRecalc = function (fc) {
        try {
            var ctrls = fc.ui && fc.ui.controls ? fc.ui.controls.get() : [];
            (ctrls||[]).forEach(function(c){
                try {
                    if (c && c.getControlType && c.getControlType() === "subgrid" && c.addOnLoad) {
                        c.addOnLoad(function(){ api.recalcItemTotalsFromInventory(fc, {persist:false, showMismatch:true}); });
                    }
                } catch(e){}
            });
        } catch(e){}
    };

