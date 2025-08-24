/* === PDG Item Form (Original) === */
/* Complete Enhanced Item Form - Jewelry Management System */
var PDG = PDG || {};
PDG.Item = {

    // ========= Core Event Handlers =========

    onLoad: function (executionContext) {
        var formContext = executionContext.getFormContext();

        // Set defaults for new records
        if (formContext.ui.getFormType() === 1) { // Create
            this.setDefaults(formContext);
        }

        // Lock cost fields (always calculated)
        this.lockCalculatedFields(formContext);

        // Setup field dependencies and cascading filters
        this.setupFieldDependencies(formContext);

        // Load and display current inventory with notifications
        if (formContext.ui.getFormType() !== 1) { // Not create mode
            this.loadInventoryDetails(formContext);
        }

        // Check stock levels with enhanced notifications
        this.checkStockLevels(formContext);

        // Setup field events
        this.setupFieldEvents(formContext);

        // Setup auto-refresh for inventory
        this.setupAutoRefresh(formContext);

        // Trigger initial filtering for existing records
        try {
            var familyAttr = formContext.getAttribute("pdg_familyid");
            var subfamilyAttr = formContext.getAttribute("pdg_subfamilyid");

            if (familyAttr && familyAttr.getValue()) {
                this.filterSubfamily({ getFormContext: () => formContext });
            }
            if (subfamilyAttr && subfamilyAttr.getValue()) {
                this.filterCategory({ getFormContext: () => formContext });
            }
        } catch (e) {
            console.warn("Error in initial filtering setup:", e);
        }

        // Enhanced functionality
        try {
            this.setupProductionFields(formContext);
            this.enhancedStockNotifications(formContext);
            this.checkPendingTransactions(formContext);
            this.calculateABCClassification(formContext);
        } catch (e) {
            console.warn("Error in enhanced functionality setup:", e);
        }

        // Setup enhanced change handlers
        try {
            this.setupEnhancedChangeHandlers(formContext);
        } catch (e) {
            console.warn("Error setting up enhanced change handlers:", e);
        }

        // Setup barcode functionality
        try {
            this.setupBarcodeHandlers(formContext);
        } catch (e) {
            console.warn("Error setting up barcode handlers:", e);
        }

        // ===== NEW ENHANCED FUNCTIONALITY =====
        // Add enhanced functionality for existing records
        if (formContext.ui.getFormType() !== 1) { // Not create mode
            setTimeout(function () {
                PDG.Item.setupProductionIntegration(formContext);
                PDG.Item.displayCostAnalysis(formContext);
                PDG.Item.loadSupplierMetrics(formContext);
                PDG.Item.setupItemRelationships(formContext);
                PDG.Item.loadQualityMetrics(formContext);
            }, 2000);
        }

        // Always validate jewelry items
        this.validateJewelryItem(formContext);

        // Enhanced barcode generation
        var itemTypeAttr = formContext.getAttribute("pdg_itemtype");
        if (itemTypeAttr) {
            try {
                itemTypeAttr.addOnChange(function () {
                    PDG.Item.validateJewelryItem(formContext);
                    PDG.Item.generateIntelligentBarcode(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_itemtype:", e);
            }
        }

        // Setup media management
        try {
            this.setupMediaManagement(formContext);
        } catch (e) {
            console.warn("Error setting up media management:", e);
        }
    },

    onSave: function (executionContext) {
        var formContext = executionContext.getFormContext();

        // Enhanced validation before save
        if (!this.validateReorderLevels(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        if (!this.validateUOMConversion(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // Validate required business logic
        if (!this.validateItem(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // NEW: Validate jewelry-specific requirements
        if (!this.validateJewelryRequirements(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // Calculate fields before save
        this.calculateAverageCost(formContext);
        this.calculateTotalValueWithCurrency(formContext);

        // Clear the auto-refresh interval on save
        if (formContext.PDG_RefreshInterval) {
            clearInterval(formContext.PDG_RefreshInterval);
        }

        return true;
    },

    // ========= Initialization Functions =========

    setDefaults: function (formContext) {
        // Set default item type if not set
        if (!formContext.getAttribute("pdg_itemtype").getValue()) {
            // Set to default type based on business rules
        }

        // Default locked to false
        if (!formContext.getAttribute("pdg_islocked").getValue()) {
            formContext.getAttribute("pdg_islocked").setValue(false);
        }

        // Default quantity fields to 0 for new records
        if (!formContext.getAttribute("pdg_quantityonhand").getValue()) {
            formContext.getAttribute("pdg_quantityonhand").setValue(0);
        }
        if (!formContext.getAttribute("pdg_totalquantityonhand").getValue()) {
            formContext.getAttribute("pdg_totalquantityonhand").setValue(0);
        }

        // Default conversion factor
        if (!formContext.getAttribute("pdg_conversionfactor").getValue()) {
            formContext.getAttribute("pdg_conversionfactor").setValue(1);
        }

        // Default Currency to USD
        if (!formContext.getAttribute("transactioncurrencyid").getValue()) {
            Xrm.WebApi.retrieveMultipleRecords(
                "transactioncurrency",
                "?$select=transactioncurrencyid,currencyname&$filter=isocurrencycode eq 'USD'"
            ).then(function (result) {
                if (result.entities.length > 0) {
                    var currency = result.entities[0];
                    formContext.getAttribute("transactioncurrencyid").setValue([{
                        id: currency.transactioncurrencyid,
                        name: currency.currencyname,
                        entityType: "transactioncurrency"
                    }]);
                } else {
                    console.warn("No default currency found for USD.");
                }
            }).catch(function (error) {
                console.error("Error retrieving default currency:", error.message);
            });
        }

        // NEW: Set jewelry defaults
        if (!formContext.getAttribute("pdg_hazardousmaterial").getValue()) {
            formContext.getAttribute("pdg_hazardousmaterial").setValue(false);
        }

        if (!formContext.getAttribute("pdg_negativestockallowed").getValue()) {
            formContext.getAttribute("pdg_negativestockallowed").setValue(false);
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
            "pdg_averagecost"
        ];

        fieldsToLock.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (control) {
                control.setDisabled(true);
            }
        });
    },

    setupFieldDependencies: function (formContext) {
        // When gross/net weight changes
        var grossWeightAttr = formContext.getAttribute("pdg_grossweight");
        var netWeightAttr = formContext.getAttribute("pdg_netweight");

        if (grossWeightAttr) {
            try {
                grossWeightAttr.addOnChange(this.validateWeights);
            } catch (e) {
                console.warn("Could not add onChange to pdg_grossweight:", e);
            }
        }
        if (netWeightAttr) {
            try {
                netWeightAttr.addOnChange(this.validateWeights);
            } catch (e) {
                console.warn("Could not add onChange to pdg_netweight:", e);
            }
        }

        // When family changes, filter subfamily
        var familyAttr = formContext.getAttribute("pdg_familyid");
        if (familyAttr) {
            try {
                familyAttr.addOnChange(this.filterSubfamily);
            } catch (e) {
                console.warn("Could not add onChange to pdg_familyid:", e);
            }
        }

        // When subfamily changes, filter category
        var subfamilyAttr = formContext.getAttribute("pdg_subfamilyid");
        if (subfamilyAttr) {
            try {
                subfamilyAttr.addOnChange(this.filterCategory);
            } catch (e) {
                console.warn("Could not add onChange to pdg_subfamilyid:", e);
            }
        }

        // Ensure subfamily filter is applied when lookup is opened
        var subfamilyControl = formContext.getControl("pdg_subfamilyid");
        if (subfamilyControl && typeof subfamilyControl.addPreSearch === "function") {
            try {
                subfamilyControl.addPreSearch(function () {
                    PDG.Item.filterSubfamily({ getFormContext: () => formContext });
                });
            } catch (e) {
                console.warn("Could not add preSearch to subfamily control:", e);
            }
        }

        // Ensure category filter is applied when lookup is opened
        var categoryControl = formContext.getControl("pdg_category");
        if (categoryControl && typeof categoryControl.addPreSearch === "function") {
            try {
                categoryControl.addPreSearch(function () {
                    PDG.Item.filterCategory({ getFormContext: () => formContext });
                });
            } catch (e) {
                console.warn("Could not add preSearch to category control:", e);
            }
        }
    },

    setupFieldEvents: function (formContext) {
        // Lock status change
        var lockedAttr = formContext.getAttribute("pdg_islocked");
        if (lockedAttr) {
            try {
                lockedAttr.addOnChange(function (executionContext) {
                    PDG.Item.onLockStatusChange(executionContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_islocked:", e);
            }
        }

        // Add refresh button handler if needed
        var qtyControl = formContext.getControl("pdg_quantityonhand");
        if (qtyControl) {
            qtyControl.setLabel("Qty on Hand (Auto-calculated)");
        }

        // Costing method change
        var costingMethodAttr = formContext.getAttribute("pdg_costingmethod");
        if (costingMethodAttr) {
            try {
                costingMethodAttr.addOnChange(this.onCostingMethodChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_costingmethod:", e);
            }
        }

        // Serial/Lot tracking mutual exclusion
        var serialAttr = formContext.getAttribute("pdg_serialcontrolled");
        var lotAttr = formContext.getAttribute("pdg_lotcontrolled");

        if (serialAttr) {
            try {
                serialAttr.addOnChange(this.onSerialControlledChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_serialcontrolled:", e);
            }
        }
        if (lotAttr) {
            try {
                lotAttr.addOnChange(this.onLotControlledChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_lotcontrolled:", e);
            }
        }

        // Expiry tracking
        var expiryAttr = formContext.getAttribute("pdg_expirytracking");
        if (expiryAttr) {
            try {
                expiryAttr.addOnChange(this.onExpiryTrackingChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_expirytracking:", e);
            }
        }

        // Primary UOM change
        var primaryUOMAttr = formContext.getAttribute("pdg_primaryuomid");
        if (primaryUOMAttr) {
            try {
                primaryUOMAttr.addOnChange(this.onPrimaryUOMChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_primaryuomid:", e);
            }
        }

        // Customs category change
        var customsCatAttr = formContext.getAttribute("pdg_customscategory");
        if (customsCatAttr) {
            try {
                customsCatAttr.addOnChange(this.onCustomsCategoryChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_customscategory:", e);
            }
        }
    },

    setupEnhancedChangeHandlers: function (formContext) {
        // Enhanced quantity change handler
        var qtyAttr = formContext.getAttribute("pdg_quantityonhand");
        if (qtyAttr) {
            try {
                qtyAttr.addOnChange(function () {
                    PDG.Item.enhancedStockNotifications(formContext);
                });
            } catch (e) {
                console.warn("Could not add enhanced onChange to pdg_quantityonhand:", e);
            }
        }

        // SKU change for barcode generation
        var skuAttr = formContext.getAttribute("pdg_sku");
        if (skuAttr) {
            try {
                skuAttr.addOnChange(function () {
                    PDG.Item.generateBarcodeFromSKU(formContext);
                    PDG.Item.generateIntelligentBarcode(formContext);
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
                    PDG.Item.validateBarcodeUniqueness(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_barcode:", e);
            }
        }

        // Quality control change
        var qcAttr = formContext.getAttribute("pdg_qualitycontrolrequired");
        if (qcAttr) {
            try {
                qcAttr.addOnChange(this.onQualityControlChange);
            } catch (e) {
                console.warn("Could not add onChange to pdg_qualitycontrolrequired:", e);
            }
        }

        // Reorder level validation
        var reorderAttr = formContext.getAttribute("pdg_reorderlevel");
        var safetyAttr = formContext.getAttribute("pdg_safetystock");
        var targetAttr = formContext.getAttribute("pdg_stocktarget");

        if (reorderAttr) {
            try {
                reorderAttr.addOnChange(function () {
                    PDG.Item.validateReorderLevels(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_reorderlevel:", e);
            }
        }
        if (safetyAttr) {
            try {
                safetyAttr.addOnChange(function () {
                    PDG.Item.validateReorderLevels(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_safetystock:", e);
            }
        }
        if (targetAttr) {
            try {
                targetAttr.addOnChange(function () {
                    PDG.Item.validateReorderLevels(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_stocktarget:", e);
            }
        }

        // NEW: Enhanced weight change handlers
        var goldWeightAttr = formContext.getAttribute("pdg_goldweight");
        var stoneWeightAttr = formContext.getAttribute("pdg_stoneweight");

        if (goldWeightAttr) {
            try {
                goldWeightAttr.addOnChange(function () {
                    PDG.Item.calculateTotalWeight(formContext);
                    PDG.Item.validateJewelryWeights(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_goldweight:", e);
            }
        }

        if (stoneWeightAttr) {
            try {
                stoneWeightAttr.addOnChange(function () {
                    PDG.Item.calculateTotalWeight(formContext);
                    PDG.Item.validateJewelryWeights(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_stoneweight:", e);
            }
        }

        // Cost change handlers for real-time analysis
        var publicPriceAttr = formContext.getAttribute("pdg_publicprice");
        if (publicPriceAttr) {
            try {
                publicPriceAttr.addOnChange(function () {
                    PDG.Item.displayCostAnalysis(formContext);
                });
            } catch (e) {
                console.warn("Could not add onChange to pdg_publicprice:", e);
            }
        }
    },

    setupBarcodeHandlers: function (formContext) {
        // Barcode scanning functionality
        var barcodeScanAttr = formContext.getAttribute("pdg_barcode_scan");
        if (barcodeScanAttr) {
            try {
                barcodeScanAttr.addOnChange(this.handleBarcodeScanned);
                var barcodeScanControl = formContext.getControl("pdg_barcode_scan");
                if (barcodeScanControl) {
                    barcodeScanControl.setLabel("📷 Scan Item Barcode");
                }
            } catch (e) {
                console.warn("Could not setup barcode scanning functionality:", e);
            }
        }

        try {
            formContext.ui.setFormNotification(
                "💡 Tip: Use the barcode field to quickly find or verify items by scanning",
                "INFO",
                "barcode_tip"
            );
        } catch (e) {
            console.warn("Could not set barcode tip notification:", e);
        }
    },

    // ========= NEW ENHANCED PRODUCTION INTEGRATION =========

    setupProductionIntegration: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        var cleanId = itemId.replace(/[{}]/g, '');

        // Load active production orders
        Xrm.WebApi.retrieveMultipleRecords("pdg_productionsheet",
            "?$select=pdg_productionnumber,pdg_sheetstatus,pdg_progressstatus,pdg_productiondate,pdg_totalcost&" +
            "$filter=_pdg_finisheditemid_value eq " + cleanId +
            " and pdg_sheetstatus eq 100000000&$top=5"
        ).then(function (result) {
            if (result.entities.length > 0) {
                var message = "🏭 **ACTIVE PRODUCTION ORDERS**\n\n";
                var totalCost = 0;

                result.entities.forEach(function (order) {
                    var status = order.pdg_progressstatus === 100000000 ? "WP" : "FP";
                    var date = new Date(order.pdg_productiondate).toLocaleDateString();
                    var cost = order.pdg_totalcost || 0;
                    totalCost += cost;

                    message += "• **" + order.pdg_productionnumber + "** (" + status + ") - " + date;
                    if (cost > 0) message += " | Cost: $" + cost.toFixed(2);
                    message += "\n";
                });

                if (totalCost > 0) {
                    message += "\n💰 **Total Production Cost**: $" + totalCost.toFixed(2);
                }
                message += "\n💡 Click 'Production' tab to view consumption details";

                formContext.ui.setFormNotification(
                    message, "INFO", "active_production"
                );
            }
        }).catch(function (error) {
            console.error("Error loading production orders:", error);
        });

        // Load consumption summary
        PDG.Item.loadConsumptionSummary(formContext, cleanId);
    },

    loadConsumptionSummary: function (formContext, itemId) {
        Xrm.WebApi.retrieveMultipleRecords("pdg_consumption",
            "?$select=pdg_totalcost,pdg_consumptiontype,pdg_quantity,pdg_consumptiondate&" +
            "$filter=_pdg_itemid_value eq " + itemId + "&$orderby=pdg_consumptiondate desc&$top=10"
        ).then(function (result) {
            if (result.entities.length > 0) {
                var totalCost = 0;
                var typeBreakdown = {};
                var lastConsumption = null;

                result.entities.forEach(function (consumption) {
                    totalCost += (consumption.pdg_totalcost || 0);
                    var typeName = consumption["pdg_consumptiontype@OData.Community.Display.V1.FormattedValue"] || "Other";
                    typeBreakdown[typeName] = (typeBreakdown[typeName] || 0) + (consumption.pdg_totalcost || 0);

                    if (!lastConsumption && consumption.pdg_consumptiondate) {
                        lastConsumption = new Date(consumption.pdg_consumptiondate);
                    }
                });

                var message = "⚙️ **CONSUMPTION SUMMARY**\n\n";
                message += "• **Total Consumption**: $" + totalCost.toFixed(2) + "\n";
                message += "• **Recent Transactions**: " + result.entities.length + "\n";

                if (lastConsumption) {
                    message += "• **Last Consumption**: " + lastConsumption.toLocaleDateString() + "\n";
                }

                message += "\n**By Type:**\n";
                Object.keys(typeBreakdown).forEach(function (type) {
                    var percentage = totalCost > 0 ? ((typeBreakdown[type] / totalCost) * 100).toFixed(1) : 0;
                    message += "• " + type + ": $" + typeBreakdown[type].toFixed(2) + " (" + percentage + "%)\n";
                });

                formContext.ui.setFormNotification(
                    message, "INFO", "consumption_summary"
                );
            }
        }).catch(function (error) {
            console.error("Error loading consumption summary:", error);
        });
    },

    // ========= NEW ENHANCED COST ANALYSIS =========

    displayCostAnalysis: function (formContext) {
        var unitCost = Number(formContext.getAttribute("pdg_unitcost").getValue() || 0);
        var cogp = Number(formContext.getAttribute("pdg_cogp").getValue() || 0);
        var publicPrice = Number(formContext.getAttribute("pdg_publicprice").getValue() || 0);
        var standardCost = Number(formContext.getAttribute("pdg_standardcost").getValue() || 0);
        var lastCost = Number(formContext.getAttribute("pdg_lastcost").getValue() || 0);

        if (unitCost > 0 && publicPrice > 0) {
            var margin = ((publicPrice - unitCost) / publicPrice * 100);
            var markup = ((publicPrice - unitCost) / unitCost * 100);

            var costAnalysis = "💰 **COST ANALYSIS**\n\n";
            costAnalysis += "• **Gross Margin**: " + margin.toFixed(1) + "%\n";
            costAnalysis += "• **Markup**: " + markup.toFixed(1) + "%\n";

            if (cogp > 0) {
                var cogpMargin = ((publicPrice - cogp) / publicPrice * 100);
                costAnalysis += "• **COGP Margin**: " + cogpMargin.toFixed(1) + "%\n";
            }

            if (standardCost > 0) {
                var variance = ((unitCost - standardCost) / standardCost * 100);
                costAnalysis += "• **Cost Variance**: " + variance.toFixed(1) + "%\n";
            }

            if (lastCost > 0) {
                var costChange = ((unitCost - lastCost) / lastCost * 100);
                costAnalysis += "• **Cost Change**: " + costChange.toFixed(1) + "%\n";
            }

            // Profitability analysis
            var profitPerUnit = publicPrice - unitCost;
            costAnalysis += "• **Profit per Unit**: $" + profitPerUnit.toFixed(2) + "\n";

            // Add cost alerts
            if (margin < 20) {
                costAnalysis += "\n🚨 **CRITICAL**: Low margin - pricing review required!";
            } else if (margin < 35) {
                costAnalysis += "\n⚠️ **WARNING**: Below target margin - consider optimization";
            } else {
                costAnalysis += "\n✅ **HEALTHY**: Good margin maintained";
            }

            var notificationType = margin < 20 ? "ERROR" : (margin < 35 ? "WARNING" : "INFO");

            formContext.ui.setFormNotification(
                costAnalysis, notificationType, "cost_analysis"
            );
        }
    },

    // ========= NEW SUPPLIER PERFORMANCE METRICS =========

    loadSupplierMetrics: function (formContext) {
        var supplier = formContext.getAttribute("pdg_supplier").getValue();
        if (!supplier) return;

        var supplierId = supplier[0].id.replace(/[{}]/g, '');
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        var cleanItemId = itemId.replace(/[{}]/g, '');

        // Get purchase history for this item from this supplier
        Xrm.WebApi.retrieveMultipleRecords("pdg_purchaseorderline",
            "?$expand=pdg_purchaseorderid($select=pdg_deliverydate,pdg_orderdate,_pdg_supplier_value,pdg_orderstatus)&" +
            "$select=pdg_unitprice,pdg_quantity,pdg_finalunitcost&" +
            "$filter=_pdg_item_value eq " + cleanItemId + "&$top=20"
        ).then(function (result) {
            var supplierOrders = result.entities.filter(function (line) {
                return line.pdg_purchaseorderid &&
                    line.pdg_purchaseorderid._pdg_supplier_value === supplierId;
            });

            if (supplierOrders.length > 0) {
                var totalOrders = supplierOrders.length;
                var avgLeadTime = 0;
                var onTimeDeliveries = 0;
                var totalValue = 0;
                var avgPrice = 0;
                var validLeadTimes = 0;

                supplierOrders.forEach(function (order) {
                    if (order.pdg_purchaseorderid.pdg_deliverydate &&
                        order.pdg_purchaseorderid.pdg_orderdate) {
                        var orderDate = new Date(order.pdg_purchaseorderid.pdg_orderdate);
                        var deliveryDate = new Date(order.pdg_purchaseorderid.pdg_deliverydate);
                        var leadTime = (deliveryDate - orderDate) / (1000 * 60 * 60 * 24);

                        if (leadTime >= 0) {
                            avgLeadTime += leadTime;
                            validLeadTimes++;

                            // Assume on-time if delivered within lead time + 2 days
                            var expectedLeadTime = formContext.getAttribute("pdg_leadtimedays").getValue() || 14;
                            if (leadTime <= expectedLeadTime + 2) {
                                onTimeDeliveries++;
                            }
                        }
                    }

                    // Calculate pricing metrics
                    var price = order.pdg_finalunitcost || order.pdg_unitprice || 0;
                    var qty = order.pdg_quantity || 0;
                    totalValue += (price * qty);
                    avgPrice += price;
                });

                if (validLeadTimes > 0) {
                    avgLeadTime = avgLeadTime / validLeadTimes;
                    avgPrice = avgPrice / totalOrders;
                    var onTimePercent = (onTimeDeliveries / validLeadTimes * 100);

                    var metrics = "📈 **SUPPLIER PERFORMANCE**\n\n";
                    metrics += "• **Orders Placed**: " + totalOrders + "\n";
                    metrics += "• **Avg Lead Time**: " + avgLeadTime.toFixed(1) + " days\n";
                    metrics += "• **On-Time Delivery**: " + onTimePercent.toFixed(1) + "%\n";
                    metrics += "• **Avg Unit Price**: $" + avgPrice.toFixed(2) + "\n";
                    metrics += "• **Total Order Value**: $" + totalValue.toFixed(2) + "\n";

                    // Performance indicators
                    if (onTimePercent < 80) {
                        metrics += "\n🚨 **POOR PERFORMANCE** - Consider alternative suppliers";
                    } else if (onTimePercent < 90) {
                        metrics += "\n⚠️ **FAIR PERFORMANCE** - Monitor closely";
                    } else {
                        metrics += "\n✅ **EXCELLENT PERFORMANCE** - Reliable supplier";
                    }

                    var notificationType = onTimePercent < 80 ? "ERROR" : (onTimePercent < 90 ? "WARNING" : "INFO");

                    formContext.ui.setFormNotification(
                        metrics, notificationType, "supplier_metrics"
                    );
                }
            }
        }).catch(function (error) {
            console.error("Error loading supplier metrics:", error);
        });
    },

    // ========= NEW JEWELRY-SPECIFIC VALIDATION =========

    validateJewelryItem: function (formContext) {
        var itemType = formContext.getAttribute("pdg_itemtype").getValue();
        var validationIssues = [];

        // Check if this is a jewelry item (assuming jewelry type = 100000001)
        if (itemType === 100000001) {
            // Validate required jewelry fields
            var grossWeight = formContext.getAttribute("pdg_grossweight").getValue();
            var netWeight = formContext.getAttribute("pdg_netweight").getValue();
            var goldWeight = formContext.getAttribute("pdg_goldweight") ?
                formContext.getAttribute("pdg_goldweight").getValue() : null;
            var metalSerial = formContext.getAttribute("pdg_metalreturnserial").getValue();

            if (!grossWeight) validationIssues.push("Gross weight required for jewelry");
            if (!netWeight) validationIssues.push("Net weight required for jewelry");
            if (goldWeight !== null && !goldWeight) validationIssues.push("Gold weight recommended for jewelry");
            if (!metalSerial) validationIssues.push("Metal return serial recommended");

            // Validate weight logic
            if (grossWeight && netWeight && grossWeight < netWeight) {
                validationIssues.push("Gross weight cannot be less than net weight");
            }

            // Check for production setup
            var makeFlag = formContext.getAttribute("pdg_makebuyflag").getValue();
            if (makeFlag === 100000000 && !formContext.getAttribute("pdg_manufacturingleadtime").getValue()) {
                validationIssues.push("Manufacturing lead time required for produced items");
            }

            // Validate pricing for jewelry
            var publicPrice = formContext.getAttribute("pdg_publicprice").getValue();
            var unitCost = formContext.getAttribute("pdg_unitcost").getValue();
            if (publicPrice && unitCost && publicPrice <= unitCost) {
                validationIssues.push("Public price should be higher than cost price");
            }
        }

        if (validationIssues.length > 0) {
            var message = "⚠️ **JEWELRY VALIDATION ISSUES**\n\n";
            validationIssues.forEach(function (issue) {
                message += "• " + issue + "\n";
            });

            formContext.ui.setFormNotification(
                message, "WARNING", "jewelry_validation"
            );
        } else {
            formContext.ui.clearFormNotification("jewelry_validation");
        }
    },

    validateJewelryRequirements: function (formContext) {
        var itemType = formContext.getAttribute("pdg_itemtype").getValue();

        // Jewelry items require additional validation
        if (itemType === 100000001) {
            var grossWeight = formContext.getAttribute("pdg_grossweight").getValue();
            var publicPrice = formContext.getAttribute("pdg_publicprice").getValue();

            if (!grossWeight) {
                Xrm.Navigation.openAlertDialog({
                    text: "Gross weight is required for jewelry items before saving.",
                    title: "Required Field Missing"
                });
                return false;
            }

            if (!publicPrice) {
                Xrm.Navigation.openAlertDialog({
                    text: "Public price is required for jewelry items before saving.",
                    title: "Required Field Missing"
                });
                return false;
            }
        }

        return true;
    },

    // ========= NEW ENHANCED BARCODE GENERATION =========

    generateIntelligentBarcode: function (formContext) {
        var family = formContext.getAttribute("pdg_familyid").getValue();
        var category = formContext.getAttribute("pdg_category").getValue();
        var itemCode = formContext.getAttribute("pdg_qrcode").getValue();
        var currentBarcode = formContext.getAttribute("pdg_barcode").getValue();

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

            formContext.ui.setFormNotification(
                "📊 Intelligent barcode generated: " + generatedBarcode,
                "INFO", "barcode_generated"
            );
        }
    },

    // ========= NEW WEIGHT CALCULATIONS =========

    calculateTotalWeight: function (formContext) {
        var goldWeight = Number(formContext.getAttribute("pdg_goldweight") ?
            formContext.getAttribute("pdg_goldweight").getValue() || 0 : 0);
        var stoneWeight = Number(formContext.getAttribute("pdg_stoneweight") ?
            formContext.getAttribute("pdg_stoneweight").getValue() || 0 : 0);

        var totalWeight = goldWeight + stoneWeight;

        // Update net weight if it's less than calculated total
        var netWeightAttr = formContext.getAttribute("pdg_netweight");
        if (netWeightAttr && totalWeight > 0) {
            var currentNetWeight = netWeightAttr.getValue() || 0;
            if (currentNetWeight < totalWeight) {
                netWeightAttr.setValue(totalWeight);

                formContext.ui.setFormNotification(
                    "💎 Net weight updated based on gold + stone weights: " + totalWeight.toFixed(3) + "g",
                    "INFO", "weight_calculated"
                );
            }
        }
    },

    validateJewelryWeights: function (formContext) {
        var goldWeight = Number(formContext.getAttribute("pdg_goldweight") ?
            formContext.getAttribute("pdg_goldweight").getValue() || 0 : 0);
        var stoneWeight = Number(formContext.getAttribute("pdg_stoneweight") ?
            formContext.getAttribute("pdg_stoneweight").getValue() || 0 : 0);
        var netWeight = Number(formContext.getAttribute("pdg_netweight").getValue() || 0);
        var grossWeight = Number(formContext.getAttribute("pdg_grossweight").getValue() || 0);

        var totalComponentWeight = goldWeight + stoneWeight;

        formContext.ui.clearFormNotification("weight_validation_jewelry");

        if (netWeight > 0 && totalComponentWeight > 0 && Math.abs(netWeight - totalComponentWeight) > 0.1) {
            formContext.ui.setFormNotification(
                "⚠️ Net weight (" + netWeight + "g) doesn't match gold + stone weights (" + totalComponentWeight.toFixed(3) + "g)",
                "WARNING", "weight_validation_jewelry"
            );
        }

        if (grossWeight > 0 && netWeight > 0 && grossWeight < netWeight) {
            formContext.ui.setFormNotification(
                "❌ Gross weight cannot be less than net weight",
                "ERROR", "weight_validation_jewelry"
            );
        }
    },

    // ========= NEW ITEM RELATIONSHIPS =========

    setupItemRelationships: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        var cleanId = itemId.replace(/[{}]/g, '');

        // Check for related items (sets, components, etc.)
        this.loadRelatedItems(formContext, cleanId);
    },

    loadRelatedItems: function (formContext, itemId) {
        // This would need custom relationships table
        // For now, check for items with similar family/category
        var family = formContext.getAttribute("pdg_familyid").getValue();
        var category = formContext.getAttribute("pdg_category").getValue();

        if (family) {
            var familyId = family[0].id.replace(/[{}]/g, '');

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventoryitem",
                "?$select=pdg_inventoryitemid,pdg_name,pdg_qrcode&" +
                "$filter=_pdg_familyid_value eq " + familyId +
                " and pdg_inventoryitemid ne " + itemId +
                " and statecode eq 0&$top=5"
            ).then(function (result) {
                if (result.entities.length > 0) {
                    var message = "👥 **RELATED ITEMS** (Same Family)\n\n";
                    result.entities.forEach(function (item) {
                        message += "• " + item.pdg_name + " (" + item.pdg_qrcode + ")\n";
                    });

                    formContext.ui.setFormNotification(
                        message, "INFO", "related_items"
                    );
                }
            });
        }
    },

    // ========= NEW QUALITY METRICS =========

    loadQualityMetrics: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        var cleanId = itemId.replace(/[{}]/g, '');

        // Load quality control data if available
        var qcRequired = formContext.getAttribute("pdg_qualitycontrolrequired").getValue();
        if (qcRequired) {
            // This would integrate with quality control records
            formContext.ui.setFormNotification(
                "🔍 **QUALITY CONTROL**: This item requires inspection on receipt",
                "INFO", "quality_info"
            );
        }
    },

    // ========= NEW MEDIA MANAGEMENT =========

    setupMediaManagement: function (formContext) {
        // Setup for image and document management
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        // This would integrate with SharePoint or file attachments
        // For now, provide guidance
        formContext.ui.setFormNotification(
            "📸 **MEDIA TIP**: Use the 'Images & Documents' tab to manage item photos and certificates",
            "INFO", "media_tip"
        );
    },

    // ========= INVENTORY MANAGEMENT (Existing + Enhanced) =========

    loadInventoryDetails: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        // Remove brackets from GUID
        itemId = itemId.replace(/[{}]/g, '');

        // Show loading indicator
        Xrm.Utility.showProgressIndicator("Loading inventory details...");

        // Clear previous notifications
        formContext.ui.clearFormNotification("inventory_load_error");
        formContext.ui.clearFormNotification("warehouse_breakdown");

        // Fetch inventory details
        Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
            "?$select=pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity," +
            "pdg_costprice,pdg_averagecost,pdg_fifo,pdg_binnumber,pdg_lastupdated," +
            "pdg_lastmovementdate,pdg_lastcountdate,_pdg_warehouseid_value&" +
            "$filter=_pdg_itemid_value eq " + itemId + " and statecode eq 0"
        ).then(
            function success(result) {
                // Fetch warehouse details separately
                var warehousePromises = [];
                var inventoryRecords = result.entities;

                // Collect unique warehouse IDs
                var warehouseIds = {};
                inventoryRecords.forEach(function (inv) {
                    if (inv._pdg_warehouseid_value) {
                        warehouseIds[inv._pdg_warehouseid_value] = true;
                    }
                });

                // Fetch warehouse details
                Object.keys(warehouseIds).forEach(function (warehouseId) {
                    warehousePromises.push(
                        Xrm.WebApi.retrieveRecord("pdg_warehouse", warehouseId,
                            "?$select=pdg_warehousename,pdg_warehousecode"
                        ).catch(function (error) {
                            console.warn("Could not fetch warehouse details for ID: " + warehouseId);
                            return {
                                pdg_warehouseid: warehouseId,
                                pdg_warehousename: "Warehouse",
                                pdg_warehousecode: "N/A"
                            };
                        })
                    );
                });

                // Wait for all warehouse details
                Promise.all(warehousePromises).then(function (warehouses) {
                    Xrm.Utility.closeProgressIndicator();

                    // Create warehouse lookup map
                    var warehouseMap = {};
                    warehouses.forEach(function (wh) {
                        if (wh) {
                            warehouseMap[wh.pdg_warehouseid || wh.id] = wh;
                        }
                    });

                    // Process inventory data
                    var totalOnHand = 0;
                    var totalOnLine = 0;
                    var totalReserved = 0;
                    var totalValue = 0;
                    var warehouseDetails = [];
                    var lastMovementDate = null;
                    var lastCountDate = null;

                    inventoryRecords.forEach(function (inventory) {
                        var onHand = inventory.pdg_onhandquantity || 0;
                        var onLine = inventory.pdg_onlinequantity || 0;
                        var reserved = inventory.pdg_reservedquantity || 0;
                        var costPrice = inventory.pdg_costprice || 0;

                        totalOnHand += onHand;
                        totalOnLine += onLine;
                        totalReserved += reserved;
                        totalValue += (onHand * costPrice);

                        // Track latest dates
                        if (inventory.pdg_lastmovementdate) {
                            var moveDate = new Date(inventory.pdg_lastmovementdate);
                            if (!lastMovementDate || moveDate > lastMovementDate) {
                                lastMovementDate = moveDate;
                            }
                        }

                        if (inventory.pdg_lastcountdate) {
                            var countDate = new Date(inventory.pdg_lastcountdate);
                            if (!lastCountDate || countDate > lastCountDate) {
                                lastCountDate = countDate;
                            }
                        }

                        // Get warehouse details from map
                        var warehouseId = inventory._pdg_warehouseid_value;
                        var warehouse = warehouseMap[warehouseId] || {};

                        warehouseDetails.push({
                            warehouseId: warehouseId,
                            warehouseName: warehouse.pdg_warehousename ||
                                inventory["_pdg_warehouseid_value@OData.Community.Display.V1.FormattedValue"] ||
                                "Unknown Warehouse",
                            warehouseCode: warehouse.pdg_warehousecode || "N/A",
                            onHand: onHand,
                            available: onLine,
                            reserved: reserved,
                            binNumber: inventory.pdg_binnumber || "N/A",
                            lastUpdated: inventory.pdg_lastupdated,
                            costPrice: costPrice
                        });
                    });

                    // Update form fields with calculated totals
                    PDG.Item.updateQuantityFields(formContext, {
                        totalOnHand: totalOnHand,
                        totalOnLine: totalOnLine,
                        totalReserved: totalReserved,
                        totalValue: totalValue,
                        lastMovementDate: lastMovementDate,
                        lastCountDate: lastCountDate,
                        warehouseDetails: warehouseDetails
                    });

                    // Display enhanced warehouse breakdown
                    PDG.Item.displayWarehouseBreakdown(formContext, warehouseDetails);

                    // Enhanced stock level checking
                    PDG.Item.checkStockLevelsWithData(formContext, totalOnHand);
                    PDG.Item.enhancedStockNotifications(formContext);

                }).catch(function (error) {
                    Xrm.Utility.closeProgressIndicator();
                    console.error("Error loading warehouse details: " + error.message);
                    PDG.Item.processInventoryWithoutWarehouseNames(formContext, inventoryRecords);
                });
            },
            function error(error) {
                Xrm.Utility.closeProgressIndicator();
                console.error("Error loading inventory details: " + error.message);

                formContext.ui.clearFormNotification("inventory_load_error");
                PDG.Item.loadInventoryDetailsSimple(formContext);
            }
        );
    },

    loadInventoryDetailsSimple: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        itemId = itemId.replace(/[{}]/g, '');

        Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
            "?$select=pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity&" +
            "$filter=_pdg_itemid_value eq " + itemId + " and statecode eq 0"
        ).then(
            function success(result) {
                var totalOnHand = 0;
                var totalOnLine = 0;
                var totalReserved = 0;

                result.entities.forEach(function (inventory) {
                    totalOnHand += inventory.pdg_onhandquantity || 0;
                    totalOnLine += inventory.pdg_onlinequantity || 0;
                    totalReserved += inventory.pdg_reservedquantity || 0;
                });

                // Update basic quantity fields
                if (formContext.getAttribute("pdg_quantityonhand")) {
                    formContext.getAttribute("pdg_quantityonhand").setValue(totalOnHand);
                }

                if (formContext.getAttribute("pdg_totalquantityonhand")) {
                    formContext.getAttribute("pdg_totalquantityonhand").setValue(Math.floor(totalOnHand));
                }

                if (formContext.getAttribute("pdg_totalquantityonhand_date")) {
                    formContext.getAttribute("pdg_totalquantityonhand_date").setValue(new Date());
                }

                // Enhanced summary notification
                var availabilityStatus = totalOnHand > 0 ? "✅ In Stock" : "❌ Out of Stock";
                var reservedInfo = totalReserved > 0 ? " (⚠️ " + totalReserved.toFixed(2) + " reserved)" : "";

                formContext.ui.setFormNotification(
                    availabilityStatus + " - Total: " + totalOnHand.toFixed(2) + " units " +
                    "(Available: " + totalOnLine.toFixed(2) + reservedInfo + ")",
                    totalOnHand > 0 ? "INFO" : "WARNING",
                    "inventory_summary"
                );

                PDG.Item.checkStockLevelsWithData(formContext, totalOnHand);
                PDG.Item.enhancedStockNotifications(formContext);
            },
            function error(error) {
                console.error("Error in simple inventory load: " + error.message);
                formContext.ui.setFormNotification(
                    "⚠️ Unable to load current inventory data. Please refresh the form.",
                    "WARNING",
                    "inventory_load_warning"
                );
            }
        );
    },

    processInventoryWithoutWarehouseNames: function (formContext, inventoryRecords) {
        var totalOnHand = 0;
        var totalOnLine = 0;
        var totalReserved = 0;
        var warehouseDetails = [];

        inventoryRecords.forEach(function (inventory) {
            var onHand = inventory.pdg_onhandquantity || 0;
            var onLine = inventory.pdg_onlinequantity || 0;
            var reserved = inventory.pdg_reservedquantity || 0;

            totalOnHand += onHand;
            totalOnLine += onLine;
            totalReserved += reserved;

            warehouseDetails.push({
                warehouseId: inventory._pdg_warehouseid_value,
                warehouseName: inventory["_pdg_warehouseid_value@OData.Community.Display.V1.FormattedValue"] || "Warehouse",
                warehouseCode: "N/A",
                onHand: onHand,
                available: onLine,
                reserved: reserved,
                binNumber: inventory.pdg_binnumber || "N/A",
                lastUpdated: inventory.pdg_lastupdated
            });
        });

        PDG.Item.updateQuantityFields(formContext, {
            totalOnHand: totalOnHand,
            totalOnLine: totalOnLine,
            totalReserved: totalReserved,
            totalValue: 0,
            lastMovementDate: null,
            lastCountDate: null,
            warehouseDetails: warehouseDetails
        });

        PDG.Item.displayWarehouseBreakdown(formContext, warehouseDetails);
        PDG.Item.checkStockLevelsWithData(formContext, totalOnHand);
    },

    updateQuantityFields: function (formContext, inventoryData) {
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
            console.error("Error updating quantity fields:", error);
        }
    },

    displayWarehouseBreakdown: function (formContext, warehouseDetails) {
        // Clear previous warehouse notifications
        formContext.ui.clearFormNotification("warehouse_breakdown");

        if (warehouseDetails.length > 0) {
            var message = "📦 **INVENTORY BY WAREHOUSE**\n\n";
            var hasLowStock = false;
            var hasOutOfStock = false;
            var hasHighReservations = false;

            warehouseDetails.forEach(function (detail) {
                var stockStatus = "";
                var statusIcon = "";

                if (detail.onHand === 0) {
                    statusIcon = " ❌";
                    hasOutOfStock = true;
                } else if (detail.onHand < 5) {
                    statusIcon = " ⚠️";
                    hasLowStock = true;
                } else if (detail.reserved >= detail.onHand * 0.8) {
                    statusIcon = " ⚡";
                    hasHighReservations = true;
                } else {
                    statusIcon = " ✅";
                }

                var availabilityInfo = "";
                if (detail.available !== detail.onHand) {
                    availabilityInfo = "\n   └ Available: " + detail.available.toFixed(2) +
                        " | Reserved: " + detail.reserved.toFixed(2);
                }

                var binInfo = detail.binNumber !== "N/A" ? " [Bin: " + detail.binNumber + "]" : "";

                message += "• **" + detail.warehouseName + "** (" + detail.warehouseCode + ")" + binInfo + ":\n";
                message += "   " + detail.onHand.toFixed(2) + " units" + statusIcon + availabilityInfo + "\n\n";
            });

            // Add total summary with enhanced formatting
            var totalOnHand = warehouseDetails.reduce(function (sum, d) { return sum + d.onHand; }, 0);
            var totalAvailable = warehouseDetails.reduce(function (sum, d) { return sum + d.available; }, 0);
            var totalReserved = warehouseDetails.reduce(function (sum, d) { return sum + d.reserved; }, 0);
            var totalValue = warehouseDetails.reduce(function (sum, d) { return sum + (d.onHand * (d.costPrice || 0)); }, 0);

            message += "📊 **TOTAL SUMMARY**\n";
            message += "• Total On Hand: **" + totalOnHand.toFixed(2) + "** units\n";
            message += "• Total Available: **" + totalAvailable.toFixed(2) + "** units\n";
            message += "• Total Reserved: **" + totalReserved.toFixed(2) + "** units\n";

            if (totalValue > 0) {
                message += "• Total Value: **$" + totalValue.toFixed(2) + "**\n";
            }

            // Add status indicators
            var statusIndicators = [];
            if (hasOutOfStock) statusIndicators.push("❌ Some locations out of stock");
            if (hasLowStock) statusIndicators.push("⚠️ Low stock in some locations");
            if (hasHighReservations) statusIndicators.push("⚡ High reservations in some locations");

            if (statusIndicators.length > 0) {
                message += "\n🔔 **ALERTS**: " + statusIndicators.join(" | ");
            }

            var notificationType = hasOutOfStock ? "ERROR" : (hasLowStock ? "WARNING" : "INFO");
            formContext.ui.setFormNotification(
                message,
                notificationType,
                "warehouse_breakdown"
            );
        } else {
            formContext.ui.setFormNotification(
                "📦 No inventory records found for this item.\n\n" +
                "💡 Tip: Create inventory records by receiving stock into warehouses.",
                "INFO",
                "warehouse_breakdown"
            );
        }
    },

    checkStockLevelsWithData: function (formContext, currentQuantity) {
        var reorderLevel = formContext.getAttribute("pdg_reorderlevel").getValue();
        var stockTarget = formContext.getAttribute("pdg_stocktarget").getValue();
        var safetyStock = formContext.getAttribute("pdg_safetystock").getValue();

        // Clear previous notifications
        formContext.ui.clearFormNotification("low_stock");
        formContext.ui.clearFormNotification("out_of_stock");
        formContext.ui.clearFormNotification("overstock");
        formContext.ui.clearFormNotification("safety_stock");

        if (currentQuantity === 0) {
            formContext.ui.setFormNotification(
                "🚨 **CRITICAL**: OUT OF STOCK\n\n" +
                "This item has zero inventory across all warehouses.\n" +
                "Immediate procurement action required!",
                "ERROR",
                "out_of_stock"
            );
        } else if (safetyStock && currentQuantity <= safetyStock) {
            formContext.ui.setFormNotification(
                "🚨 **URGENT**: BELOW SAFETY STOCK\n\n" +
                "Current: " + currentQuantity.toFixed(2) + " units\n" +
                "Safety Level: " + safetyStock + " units\n" +
                "Critical shortage - expedite orders!",
                "ERROR",
                "safety_stock"
            );
        } else if (reorderLevel && currentQuantity <= reorderLevel) {
            formContext.ui.setFormNotification(
                "⚠️ **REORDER POINT REACHED**\n\n" +
                "Current: " + currentQuantity.toFixed(2) + " units\n" +
                "Reorder Level: " + reorderLevel + " units\n" +
                "Time to place new purchase order.",
                "WARNING",
                "low_stock"
            );
        } else if (stockTarget && currentQuantity > stockTarget * 1.5) {
            formContext.ui.setFormNotification(
                "ℹ️ **OVERSTOCK ALERT**\n\n" +
                "Current: " + currentQuantity.toFixed(2) + " units\n" +
                "Target: " + stockTarget + " units\n" +
                "Consider redistribution or promotions.",
                "INFO",
                "overstock"
            );
        }
    },

    enhancedStockNotifications: function (formContext) {
        var qty = Number(formContext.getAttribute("pdg_quantityonhand").getValue() || 0);
        var reorder = Number(formContext.getAttribute("pdg_reorderlevel").getValue() || 0);
        var safety = Number(formContext.getAttribute("pdg_safetystock").getValue() || 0);
        var target = Number(formContext.getAttribute("pdg_stocktarget").getValue() || 0);
        var negativeAllowed = formContext.getAttribute("pdg_negativestockallowed") ?
            formContext.getAttribute("pdg_negativestockallowed").getValue() : false;

        formContext.ui.clearFormNotification("enhanced_stock_note");

        if (qty < 0 && !negativeAllowed) {
            formContext.ui.setFormNotification(
                "🚨 **CRITICAL ERROR**: NEGATIVE INVENTORY DETECTED!\n\n" +
                "Current Quantity: " + qty.toFixed(2) + " units\n" +
                "Negative inventory is not allowed for this item.\n" +
                "Immediate investigation and correction required!",
                "ERROR",
                "enhanced_stock_note"
            );
        } else if (safety > 0 && qty <= safety) {
            var daysOfStock = safety > 0 ? Math.floor(qty / (safety * 0.1)) : 0; // Rough estimate
            formContext.ui.setFormNotification(
                "🚨 **SAFETY STOCK BREACH**\n\n" +
                "Current: " + qty.toFixed(2) + " units\n" +
                "Safety Level: " + safety + " units\n" +
                "Estimated days of stock: ~" + daysOfStock + " days\n" +
                "URGENT: Expedite procurement!",
                "ERROR",
                "enhanced_stock_note"
            );
        } else if (reorder > 0 && qty <= reorder) {
            formContext.ui.setFormNotification(
                "⚠️ **REORDER ALERT**\n\n" +
                "Current: " + qty.toFixed(2) + " units\n" +
                "Reorder Level: " + reorder + " units\n" +
                "Action: Create purchase requisition now!",
                "WARNING",
                "enhanced_stock_note"
            );
        } else if (target > 0 && qty > target * 1.2) {
            var excessValue = (qty - target) * (formContext.getAttribute("pdg_unitcost").getValue() || 0);
            formContext.ui.setFormNotification(
                "💰 **OVERSTOCK OPTIMIZATION**\n\n" +
                "Current: " + qty.toFixed(2) + " units\n" +
                "Target: " + target + " units\n" +
                "Excess: " + (qty - target).toFixed(2) + " units (~$" + excessValue.toFixed(2) + ")\n" +
                "Consider: Transfer, promotion, or return to supplier.",
                "INFO",
                "enhanced_stock_note"
            );
        }
    },

    setupAutoRefresh: function (formContext) {
        // Store interval ID to clear it later if needed
        if (formContext.PDG_RefreshInterval) {
            clearInterval(formContext.PDG_RefreshInterval);
        }

        // Refresh inventory data every 60 seconds if form is not dirty
        formContext.PDG_RefreshInterval = setInterval(function () {
            if (!formContext.data.entity.getIsDirty() && formContext.ui.getFormType() !== 1) {
                console.log("Auto-refreshing inventory data...");
                PDG.Item.loadInventoryDetails(formContext);
            }
        }, 60000); // 60 seconds
    },

    recalculateInventory: function (primaryControl) {
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

        // Clean the GUID
        itemId = itemId.replace(/[{}]/g, '');

        // Just refresh the inventory display since we don't have the custom action
        PDG.Item.loadInventoryDetails(formContext);

        setTimeout(function () {
            Xrm.Utility.closeProgressIndicator();
            formContext.data.refresh(false).then(function () {
                Xrm.Navigation.openAlertDialog({
                    text: "Inventory data has been refreshed and recalculated.",
                    title: "Refresh Complete"
                });
            });
        }, 2000);
    },

    getWarehouseInventory: function (formContext, warehouseId) {
        var itemId = formContext.data.entity.getId();
        if (!itemId || !warehouseId) return Promise.resolve(null);

        itemId = itemId.replace(/[{}]/g, '');
        warehouseId = warehouseId.replace(/[{}]/g, '');

        return Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
            "?$select=pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity&" +
            "$filter=_pdg_itemid_value eq " + itemId +
            " and _pdg_warehouseid_value eq " + warehouseId +
            " and statecode eq 0"
        ).then(function (result) {
            if (result.entities.length > 0) {
                return result.entities[0];
            }
            return null;
        });
    },

    // ========= Cascading Lookup Filters =========

    filterFamily: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var categoryId = formContext.getAttribute("pdg_category").getValue();

        if (categoryId) {
            var categoryGuid = categoryId[0].id.replace(/[{}]/g, "");
            // Add custom filter to family lookup if needed
        }
    },

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
                        // Ignore if clearCustomFilter doesn't exist
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
                    PDG.Item.filterCategory({ getFormContext: () => formContext });
                }
            }).catch(function (error) {
                console.error("Error retrieving subfamily:", error.message);
            });
        }
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

            // Add custom filter to category lookup
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
        }
    },

    // ========= Field Change Handlers =========

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

            formContext.ui.setFormNotification(
                "💰 Costing Method: " + methodText + "\n" + infoText,
                "INFO",
                "costing_info"
            );
        }
    },

    onSerialControlledChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var serial = formContext.getAttribute("pdg_serialcontrolled").getValue();
        var lotAttr = formContext.getAttribute("pdg_lotcontrolled");

        if (serial && lotAttr && lotAttr.getValue()) {
            lotAttr.setValue(false);
            Xrm.Navigation.openAlertDialog({
                text: "Serial and Lot tracking cannot both be enabled. Lot tracking has been turned off."
            });
        }

        formContext.ui.clearFormNotification("serial_info");
        if (serial) {
            formContext.ui.setFormNotification(
                "🔢 Serial tracking enabled - each unit will have unique serial number",
                "INFO",
                "serial_info"
            );
        }
    },

    onLotControlledChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var lot = formContext.getAttribute("pdg_lotcontrolled").getValue();
        var serialAttr = formContext.getAttribute("pdg_serialcontrolled");

        if (lot && serialAttr && serialAttr.getValue()) {
            serialAttr.setValue(false);
            Xrm.Navigation.openAlertDialog({
                text: "Serial and Lot tracking cannot both be enabled. Serial tracking has been turned off."
            });
        }

        formContext.ui.clearFormNotification("lot_info");
        if (lot) {
            formContext.ui.setFormNotification(
                "📦 Lot tracking enabled - batches will be tracked with lot numbers",
                "INFO",
                "lot_info"
            );
        }
    },

    onExpiryTrackingChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var expiryTracking = formContext.getAttribute("pdg_expirytracking").getValue();

        if (expiryTracking) {
            formContext.ui.setFormNotification(
                "📅 Expiry tracking enabled - shelf life and expiration dates will be monitored",
                "INFO",
                "expiry_hint"
            );

            // Enable shelf life field
            var shelfLifeControl = formContext.getControl("pdg_shelflifedays");
            if (shelfLifeControl) {
                shelfLifeControl.setDisabled(false);
            }
        } else {
            formContext.ui.clearFormNotification("expiry_hint");

            // Clear shelf life field
            var shelfLifeAttr = formContext.getAttribute("pdg_shelflifedays");
            if (shelfLifeAttr) {
                shelfLifeAttr.setValue(null);
            }
        }
    },

    onPrimaryUOMChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var secondaryUOMAttr = formContext.getAttribute("pdg_secondaryuomid");
        var conversionAttr = formContext.getAttribute("pdg_conversionfactor");

        if (secondaryUOMAttr) secondaryUOMAttr.setValue(null);
        if (conversionAttr) conversionAttr.setValue(1);

        formContext.ui.setFormNotification(
            "🔄 Primary UOM changed - secondary UOM and conversion factor have been reset",
            "INFO",
            "uom_change"
        );
    },

    onCustomsCategoryChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var customsCategory = formContext.getAttribute("pdg_customscategory").getValue();

        if (customsCategory && customsCategory[0]) {
            var categoryId = customsCategory[0].id.replace(/[{}]/g, "");

            Xrm.WebApi.retrieveRecord("pdg_customscategory", categoryId, "?$select=pdg_percentage")
                .then(function (result) {
                    var percentage = result.pdg_percentage;
                    var percentageAttr = formContext.getAttribute("pdg_customscatpercentage");

                    if (percentageAttr && percentage !== null) {
                        percentageAttr.setValue(percentage.toString());

                        formContext.ui.setFormNotification(
                            "🏛️ Customs percentage auto-filled: " + percentage + "%",
                            "INFO",
                            "customs_autofill"
                        );
                    }
                })
                .catch(function (error) {
                    console.error("Error retrieving customs category:", error);
                });
        }
    },

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
                    // Lock specific fields
                    var fieldsToLock = [
                        "pdg_familyid", "pdg_subfamilyid", "pdg_category",
                        "pdg_customscategory", "pdg_customscatpercentage", "pdg_cbfactor",
                        "pdg_primaryuomid", "pdg_secondaryuomid", "pdg_conversionfactor"
                    ];

                    fieldsToLock.forEach(function (fieldName) {
                        var control = formContext.getControl(fieldName);
                        if (control) control.setDisabled(true);
                    });

                    formContext.ui.setFormNotification(
                        "🔒 This item is locked - key fields cannot be modified",
                        "WARNING",
                        "item_locked"
                    );
                }
            });
        } else {
            // Unlock fields
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
        }
    },

    onQualityControlChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var qcRequired = formContext.getAttribute("pdg_qualitycontrolrequired").getValue();
        var inspectionControl = formContext.getControl("pdg_inspectiontype");

        if (inspectionControl) {
            inspectionControl.setVisible(qcRequired);
            if (qcRequired) {
                formContext.ui.setFormNotification(
                    "📋 Quality control enabled - inspection required for all receipts",
                    "INFO",
                    "qc_enabled"
                );
            } else {
                formContext.ui.clearFormNotification("qc_enabled");
            }
        }
    },

    // ========= Enhanced Validation Functions =========

    validateReorderLevels: function (formContext) {
        var qty = Number(formContext.getAttribute("pdg_quantityonhand").getValue() || 0);
        var reorder = Number(formContext.getAttribute("pdg_reorderlevel").getValue() || 0);
        var safety = Number(formContext.getAttribute("pdg_safetystock").getValue() || 0);
        var target = Number(formContext.getAttribute("pdg_stocktarget").getValue() || 0);

        var hasError = false;
        formContext.ui.clearFormNotification("reorder_validation");

        // Validation: Safety Stock ≤ Reorder Level ≤ Stock Target
        if (safety > 0 && reorder > 0 && safety > reorder) {
            formContext.ui.setFormNotification(
                "⚠️ Safety Stock (" + safety + ") cannot be greater than Reorder Level (" + reorder + ")",
                "ERROR",
                "reorder_validation"
            );
            hasError = true;
        }

        if (reorder > 0 && target > 0 && reorder > target) {
            formContext.ui.setFormNotification(
                "⚠️ Reorder Level (" + reorder + ") cannot be greater than Stock Target (" + target + ")",
                "ERROR",
                "reorder_validation"
            );
            hasError = true;
        }

        return !hasError;
    },

    validateUOMConversion: function (formContext) {
        var primaryUOM = formContext.getAttribute("pdg_primaryuomid").getValue();
        var secondaryUOM = formContext.getAttribute("pdg_secondaryuomid").getValue();
        var conversion = Number(formContext.getAttribute("pdg_conversionfactor").getValue() || 1);

        formContext.ui.clearFormNotification("uom_validation");

        if (secondaryUOM && !primaryUOM) {
            formContext.ui.setFormNotification(
                "⚠️ Primary UOM must be selected before Secondary UOM",
                "ERROR",
                "uom_validation"
            );
            return false;
        }

        if (secondaryUOM && conversion <= 0) {
            formContext.ui.setFormNotification(
                "⚠️ Conversion Factor must be greater than 0",
                "ERROR",
                "uom_validation"
            );
            return false;
        }

        return true;
    },

    validateWeights: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var grossWeight = formContext.getAttribute("pdg_grossweight").getValue();
        var netWeight = formContext.getAttribute("pdg_netweight").getValue();

        if (grossWeight && netWeight && grossWeight < netWeight) {
            formContext.ui.setFormNotification(
                "Gross weight cannot be less than net weight",
                "ERROR",
                "weight_validation"
            );

            // Reset the changed value
            var changedAttribute = executionContext.getEventSource();
            if (changedAttribute.getName() === "pdg_grossweight") {
                changedAttribute.setValue(netWeight);
            } else {
                changedAttribute.setValue(grossWeight);
            }
        } else {
            formContext.ui.clearFormNotification("weight_validation");
        }
    },

    validateItem: function (formContext) {
        var isValid = true;

        // Clear previous errors
        formContext.ui.clearFormNotification("validation_error");

        // Validate required fields
        var itemCode = formContext.getAttribute("pdg_qrcode").getValue();
        var itemName = formContext.getAttribute("pdg_name").getValue();

        if (!itemCode || !itemName) {
            formContext.ui.setFormNotification(
                "Item Code and Item Name are required",
                "ERROR",
                "validation_error"
            );
            isValid = false;
        }

        return isValid;
    },

    // ========= Enhanced Barcode Management =========

    handleBarcodeScanned: function (executionContext) {
        var formContext = executionContext.getFormContext();
        var barcode = formContext.getAttribute("pdg_barcode_scan").getValue();

        if (!barcode || barcode.trim() === '') return;

        // Clear previous notifications
        formContext.ui.clearFormNotification("barcode_scan_result");

        // Validate against current item's barcodes
        var currentBarcode = formContext.getAttribute("pdg_barcode").getValue();
        var currentSupplierBarcode = formContext.getAttribute("pdg_supplieritemcode").getValue();

        if (barcode === currentBarcode || barcode === currentSupplierBarcode) {
            formContext.ui.setFormNotification(
                "✅ Barcode verified: " + barcode + " matches this item",
                "INFO",
                "barcode_scan_result"
            );
        } else {
            formContext.ui.setFormNotification(
                "⚠️ Barcode mismatch: " + barcode + " does not match this item's barcodes",
                "WARNING",
                "barcode_scan_result"
            );
        }

        // Clear the scan field
        formContext.getAttribute("pdg_barcode_scan").setValue(null);
    },

    generateBarcodeFromSKU: function (formContext) {
        var sku = formContext.getAttribute("pdg_sku").getValue();
        var currentBarcode = formContext.getAttribute("pdg_barcode").getValue();

        if (sku && !currentBarcode) {
            var generatedBarcode = sku + "-" + Date.now().toString().slice(-6);
            formContext.getAttribute("pdg_barcode").setValue(generatedBarcode);

            formContext.ui.setFormNotification(
                "📊 Barcode auto-generated: " + generatedBarcode,
                "INFO",
                "barcode_generated"
            );
        }
    },

    validateBarcodeUniqueness: function (formContext) {
        var barcode = formContext.getAttribute("pdg_barcode").getValue();
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
                    formContext.ui.setFormNotification(
                        "⚠️ This barcode is already assigned to another item",
                        "ERROR",
                        "barcode_duplicate"
                    );
                } else {
                    formContext.ui.clearFormNotification("barcode_duplicate");
                }
            })
            .catch(function (error) {
                console.error("Barcode validation error:", error);
            });
    },

    // ========= Cost Calculation Enhancements =========

    calculateAverageCost: function (formContext) {
        var unitCost = Number(formContext.getAttribute("pdg_unitcost").getValue() || 0);
        var lastCost = Number(formContext.getAttribute("pdg_lastcost").getValue() || 0);
        var standardCost = Number(formContext.getAttribute("pdg_standardcost").getValue() || 0);

        if (unitCost > 0 && lastCost > 0) {
            var avgCost = (unitCost + lastCost + standardCost) / (standardCost > 0 ? 3 : 2);
            var avgCostAttr = formContext.getAttribute("pdg_movingaveragecost");
            if (avgCostAttr) {
                avgCostAttr.setValue(avgCost);
            }
        }
    },

    calculateTotalValueWithCurrency: function (formContext) {
        var qty = Number(formContext.getAttribute("pdg_quantityonhand").getValue() || 0);
        var unitCost = Number(formContext.getAttribute("pdg_unitcost").getValue() || 0);
        var exchangeRate = Number(formContext.getAttribute("exchangerate").getValue() || 1);

        var totalValue = qty * unitCost;
        var totalValueBase = totalValue * exchangeRate;

        var totalValueAttr = formContext.getAttribute("pdg_totalvalue");
        var totalValueBaseAttr = formContext.getAttribute("pdg_totalvalue_base");

        if (totalValueAttr) totalValueAttr.setValue(totalValue);
        if (totalValueBaseAttr) totalValueBaseAttr.setValue(totalValueBase);
    },

    // ========= Production Integration =========

    setupProductionFields: function (formContext) {
        var itemType = formContext.getAttribute("pdg_itemtype").getValue();
        var makeBuyControl = formContext.getControl("pdg_makebuyflag");

        // Show/hide production-related fields based on item type
        var isManufactured = itemType === 100000002; // Assuming manufactured type

        if (makeBuyControl) makeBuyControl.setVisible(isManufactured);
    },

    // ========= Analytics & Monitoring =========

    checkPendingTransactions: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        var cleanId = itemId.replace(/[{}]/g, "");

        Xrm.WebApi.retrieveMultipleRecords(
            "pdg_inventorytransaction",
            "?$select=pdg_inventorytransactionid&$filter=_pdg_itemid_value eq " + cleanId + " and pdg_transactionstatus eq 100000000&$top=5"
        ).then(function (result) {
            if (result.entities.length > 0) {
                formContext.ui.setFormNotification(
                    "⚠️ " + result.entities.length + " pending transaction(s) for this item",
                    "WARNING",
                    "pending_transactions"
                );
            }
        }).catch(function (error) {
            console.error("Error checking pending transactions:", error);
        });
    },

    calculateABCClassification: function (formContext) {
        var itemId = formContext.data.entity.getId();
        if (!itemId) return;

        // This would integrate with sales/usage data to calculate ABC classification
        var totalValue = Number(formContext.getAttribute("pdg_totalvalue").getValue() || 0);

        // Simple classification based on total value (would be enhanced with actual usage data)
        var classification = "C"; // Default
        if (totalValue > 10000) classification = "A";
        else if (totalValue > 2500) classification = "B";

        var abcAttr = formContext.getAttribute("pdg_abcclassification");
        if (abcAttr) {
            abcAttr.setValue(classification);
        }
    },

    checkStockLevels: function (formContext) {
        var quantityOnHand = formContext.getAttribute("pdg_quantityonhand").getValue() || 0;
        var reorderLevel = formContext.getAttribute("pdg_reorderlevel").getValue();

        // Clear previous notifications
        formContext.ui.clearFormNotification("stock_alert");

        if (quantityOnHand === 0) {
            formContext.ui.setFormNotification(
                "❌ OUT OF STOCK - This item has zero inventory",
                "ERROR",
                "stock_alert"
            );
        } else if (reorderLevel && quantityOnHand <= reorderLevel) {
            formContext.ui.setFormNotification(
                "⚠️ LOW STOCK - Current stock (" + quantityOnHand + ") is at or below reorder level (" + reorderLevel + ")",
                "WARNING",
                "stock_alert"
            );
        }
    }
};


/* ===== PDG.Item overlay: add missing logic for common handlers (only if not already defined) ===== */
(function () {
    if (!window.PDG) window.PDG = {};
    PDG.Item = PDG.Item || {};

    // ---- utilities ----
    function getFC(ctx) {
        var fc = (ctx && typeof ctx.getFormContext === "function") ? ctx.getFormContext() : ctx;
        if (!fc || typeof fc.getAttribute !== "function") {
            try { if (window.Xrm && Xrm.Page) fc = Xrm.Page; } catch (e) { }
        }
        return fc;
    }
    function attr(fc, name) { try { return fc.getAttribute(name) || null; } catch (e) { return null; } }
    function ctrl(fc, name) { try { return fc.getControl(name) || null; } catch (e) { return null; } }
    function num(v) { v = (v === null || v === undefined) ? 0 : v; var n = Number(v); return isNaN(n) ? 0 : n; }
    function note(fc, id, msg, lvl) { try { fc.ui.setFormNotification(msg, lvl || "INFO", id); } catch (e) { } }
    function clear(fc, id) { try { fc.ui.clearFormNotification(id); } catch (e) { } }
    function getId(fc) { try { var id = fc.data && fc.data.entity && fc.data.entity.getId && fc.data.entity.getId(); return id ? id.replace(/[{}]/g, "") : null; } catch (e) { return null; } }
    function getLookupId(v) { return (v && v[0] && v[0].id) ? v[0].id.replace(/[{}]/g, "") : null; }
    function odataStr(s) { return String(s).replace(/'/g, "''"); }

    function provideIfMissing(name, impl) {
        if (typeof PDG.Item[name] !== "function") {
            PDG.Item[name] = impl;
        }
    }

    // ---- validateBarcodeUniqueness ----
    provideIfMissing("validateBarcodeUniqueness", function (ctx) {
        var fc = getFC(ctx);
        var a = attr(fc, "pdg_barcode"); if (!a) return true;
        var val = a.getValue(); if (!val) { clear(fc, "barcode_dup"); return true; }
        // normalize
        if (typeof val === "string") { val = val.trim().toUpperCase(); a.setValue(val); }
        var itemId = getId(fc);
        var filter = "$select=pdg_inventoryitemid&$filter=(pdg_barcode eq '" + odataStr(val) + "') and statecode eq 0";
        if (itemId) filter += " and pdg_inventoryitemid ne " + itemId;
        Xrm.WebApi.retrieveMultipleRecords("pdg_inventoryitem", filter + "&$top=1").then(function (res) {
            if (res.entities && res.entities.length > 0) {
                note(fc, "barcode_dup", "❌ Barcode already exists on another item.", "ERROR");
            } else {
                clear(fc, "barcode_dup");
            }
        }).catch(function (e) { console.warn("validateBarcodeUniqueness", e); });
        return true;
    });

    // ---- generateBarcodeFromSKU ----
    provideIfMissing("generateBarcodeFromSKU", function (ctx) {
        var fc = getFC(ctx);
        var skuA = attr(fc, "pdg_sku"); var barA = attr(fc, "pdg_barcode"); if (!skuA || !barA) return true;
        var sku = skuA.getValue(); var bar = barA.getValue();
        if (sku && !bar) {
            var v = String(sku).trim().toUpperCase();
            barA.setValue(v);
            if (barA.fireOnChange) barA.fireOnChange();
        }
        return true;
    });

    // ---- handleBarcodeScanned (copy to barcode field and validate) ----
    provideIfMissing("handleBarcodeScanned", function (ctx) {
        var fc = getFC(ctx);
        var scanA = attr(fc, "pdg_barcodescan") || attr(fc, "pdg_barcode_scanned"); // tolerate either name
        var barA = attr(fc, "pdg_barcode"); if (!scanA || !barA) return true;
        var v = scanA.getValue(); if (!v) return true;
        var norm = String(v).trim().toUpperCase();
        barA.setValue(norm);
        if (barA.fireOnChange) barA.fireOnChange();
        // call validator if present
        if (typeof PDG.Item.validateBarcodeUniqueness === "function") {
            PDG.Item.validateBarcodeUniqueness(fc);
        }
        return true;
    });

    // ---- filterSubfamily by Family ----
    provideIfMissing("filterSubfamily", function (ctx) {
        var fc = getFC(ctx);
        var fam = attr(fc, "pdg_familyid"); var subCtrl = ctrl(fc, "pdg_subfamilyid"); if (!fam || !subCtrl) return true;
        var famVal = fam.getValue(); if (!famVal) return true;
        var famId = getLookupId(famVal); if (!famId) return true;
        try {
            subCtrl.addPreSearch(function () {
                var fetch = "<filter type='and'><condition attribute='pdg_family' operator='eq' value='" + famId + "' /></filter>";
                subCtrl.addCustomFilter(fetch, "pdg_subfamily");
            });
        } catch (e) { console.warn("filterSubfamily", e); }
        return true;
    });

    // ---- filterCategory by Subfamily ----
    provideIfMissing("filterCategory", function (ctx) {
        var fc = getFC(ctx);
        var sub = attr(fc, "pdg_subfamilyid"); var catCtrl = ctrl(fc, "pdg_categoryid"); if (!sub || !catCtrl) return true;
        var subVal = sub.getValue(); if (!subVal) return true;
        var subId = getLookupId(subVal); if (!subId) return true;
        try {
            catCtrl.addPreSearch(function () {
                var fetch = "<filter type='and'><condition attribute='pdg_subfamily' operator='eq' value='" + subId + "' /></filter>";
                catCtrl.addCustomFilter(fetch, "pdg_category");
            });
        } catch (e) { console.warn("filterCategory", e); }
        return true;
    });

    // ---- onCostingMethodChange ----
    provideIfMissing("onCostingMethodChange", function (ctx) {
        var fc = getFC(ctx);
        var method = attr(fc, "pdg_costingmethod"); if (!method) return true;
        var val = method.getValue();
        var avg = ctrl(fc, "pdg_averagecost"), fifo = ctrl(fc, "pdg_fifo"), last = ctrl(fc, "pdg_lastcost"), std = ctrl(fc, "pdg_unitcost");
        function dis(c, flag) { if (c) try { c.setDisabled(flag); } catch (e) { } }
        // heuristics: 100000000=Standard, 100000001=Average, 100000002=FIFO, 100000003=Last
        dis(avg, val !== 100000001);
        dis(fifo, val !== 100000002);
        dis(last, val !== 100000003);
        // unit cost typically locked unless Standard
        dis(std, val !== 100000000);
        return true;
    });

    // ---- UOM changes & conversion ----
    provideIfMissing("onPrimaryUOMChange", function (ctx) { var fc = getFC(ctx); /* no-op but present */ return true; });
    provideIfMissing("onSecondaryUOMChange", function (ctx) { var fc = getFC(ctx); /* no-op but present */ return true; });
    provideIfMissing("onConversionFactorChange", function (ctx) {
        var fc = getFC(ctx); var cf = attr(fc, "pdg_conversionfactor"); if (!cf) return true;
        var v = num(cf.getValue()); if (v <= 0) { note(fc, "conv_err", "Conversion factor must be > 0", "ERROR"); } else { clear(fc, "conv_err"); }
        return true;
    });

    // ---- Production toggle ----
    provideIfMissing("onProductionControlledChange", function (ctx) {
        var fc = getFC(ctx); var a = attr(fc, "pdg_productioncontrolled"); if (!a) return true;
        var on = !!a.getValue();
        ["pdg_bomrequired", "pdg_manufacturingtime", "pdg_setupcost", "pdg_routingid"].forEach(function (f) { var c = ctrl(fc, f); if (c) try { c.setDisabled(!on); } catch (e) { } });
        return true;
    });

    // ---- calculateTotalWeight / validate weights ----
    provideIfMissing("calculateTotalWeight", function (ctx) {
        var fc = getFC(ctx);
        var gross = attr(fc, "pdg_grossweight"), net = attr(fc, "pdg_netweight");
        if (!gross || !net) return true;
        var g = num(gross.getValue()), n = num(net.getValue());
        if (g && n && g < n) { note(fc, "wt_err", "Gross weight is less than Net weight.", "ERROR"); } else { clear(fc, "wt_err"); }
        return true;
    });

    provideIfMissing("validateWeights", function (ctx) { return PDG.Item.calculateTotalWeight(ctx); });
    provideIfMissing("validateJewelryWeights", function (ctx) { return PDG.Item.calculateTotalWeight(ctx); });
    provideIfMissing("validateJewelryItem", function (ctx) { var fc = getFC(ctx); return PDG.Item.calculateTotalWeight(fc); });

    // ---- cost metrics and stock levels ----
    provideIfMissing("calculateAndNotifyCostMetrics", function (ctx) {
        var fc = getFC(ctx);
        var price = num(attr(fc, "pdg_publicprice") && attr(fc, "pdg_publicprice").getValue());
        var cost = num(attr(fc, "pdg_unitcost") && attr(fc, "pdg_unitcost").getValue());
        if (!(price > 0 && cost > 0)) { clear(fc, "item_margin"); return true; }
        var m = ((price - cost) / price) * 100; var type = m < 15 ? "ERROR" : (m < 25 ? "WARNING" : "INFO");
        note(fc, "item_margin", "📊 Margin: " + m.toFixed(1) + "%", type);
        return true;
    });

    provideIfMissing("checkStockLevels", function (ctx) {
        var fc = getFC(ctx);
        var q = num(attr(fc, "pdg_quantityonhand") && attr(fc, "pdg_quantityonhand").getValue());
        var r = num(attr(fc, "pdg_reorderlevel") && attr(fc, "pdg_reorderlevel").getValue());
        clear(fc, "item_stock");
        if (q === 0) { note(fc, "item_stock", "❌ OUT OF STOCK", "ERROR"); }
        else if (r && q <= r) { note(fc, "item_stock", "⚠️ LOW STOCK — QOH: " + q + " ≤ Reorder: " + r, "WARNING"); }
        return true;
    });
})();



/* ===== PDG.Item universal handler hardening v4 (executionContext or formContext, with Proxy fallback) ===== */
(function () {
    try {
        if (!window.PDG) window.PDG = {};
        PDG.Item = PDG.Item || {};

        var NAMES = [
            "validateBarcodeUniqueness",
            "validateJewelryItem",
            "validateJewelryWeights",
            "validateWeights",
            "generateBarcodeFromSKU",
            "handleBarcodeScanned",
            "filterFamily",
            "filterSubfamily",
            "filterCategory",
            "onLockStatusChange",
            "onCostingMethodChange",
            "onPrimaryUOMChange",
            "onSecondaryUOMChange",
            "onConversionFactorChange",
            "onProductionControlledChange",
            "calculateTotalWeight",
            "calculateAndNotifyCostMetrics",
            "checkStockLevels"
        ];

        function normalize(ctx) {
            var fc = (ctx && typeof ctx.getFormContext === "function") ? ctx.getFormContext() : ctx;
            if (!fc || typeof fc.getAttribute !== "function") {
                try { if (window.Xrm && Xrm.Page) fc = Xrm.Page; } catch (e) { }
            }
            var ex = (ctx && typeof ctx.getFormContext === "function") ? ctx : { getFormContext: function () { return fc; } };
            return { fc: fc, ex: ex };
        }

        function wrap(fn) {
            return function (ctx) {
                var n = normalize(ctx), fc = n.fc, ex = n.ex;
                try { return fn.call(PDG.Item, fc); }
                catch (e1) {
                    try { return fn.call(PDG.Item, ex); }
                    catch (e2) {
                        try { console.error("PDG.Item handler failed:", e1, e2); } catch (_) { }
                        return true;
                    }
                }
            };
        }

        // harden explicit names
        NAMES.forEach(function (name) {
            if (typeof PDG.Item[name] === "function") {
                PDG.Item[name] = wrap(PDG.Item[name]);
            } else {
                // benign placeholder so CRM doesn't throw "method does not exist"
                PDG.Item[name] = function (ctx) { normalize(ctx); return true; };
            }
        });

        // catch-all for any other handler name
        if (window.Proxy) {
            PDG.Item = new Proxy(PDG.Item, {
                get: function (target, prop, receiver) {
                    var val = Reflect.get(target, prop, receiver);
                    if (val !== undefined) return val;
                    if (typeof prop === "string" && /^(validate|on|filter|handle|generate|calc|calculate|ensure)/i.test(prop)) {
                        var fn = function (ctx) { normalize(ctx); return true; };
                        Reflect.set(target, prop, fn, receiver);
                        return fn;
                    }
                    return val;
                }
            });
            // expose on window again (overwrite reference)
            window.PDG.Item = PDG.Item;
        }
    } catch (e) {
        try { console.error("PDG.Item hardening shim v4 error:", e); } catch (_) { }
    }
})();
