/* === PDG Production Sheet Form - Complete JavaScript === */
var PDG = PDG || {};
PDG.ProductionSheet = {

    // ========= Constants =========
    SHEET_STATUS: {
        OPEN: 100000000,
        CLOSED: 100000001,
        CANCELLED: 100000002
    },

    PROGRESS_STATUS: {
        WP: 100000000, // Work in Progress
        FP: 100000001  // Finished Progress
    },

    CLOSE_STATUS: {
        READY: 100000000,
        PENDING: 100000001,
        COMPLETED: 100000002
    },

    // ========= Core Event Handlers =========

    // Returns a formContext from various inputs (executionContext, formContext, or Xrm.Page)
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") {
                return ctx.getFormContext();
            }
            // If a formContext was passed directly
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") {
                return ctx;
            }
            // Fallback for legacy scripts if execution context not passed
            if (typeof Xrm !== "undefined" && Xrm.Page) {
                return Xrm.Page;
            }
        } catch (e) { /* ignore and throw below */ }
        throw new Error("Form context not available. Ensure 'Pass execution context' is enabled.");
    },

    onLoad: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);

        console.log("PDG Production Sheet: Form Load Started");

        // Resolve picklist option values based on current environment labels
        this.resolveOptionValues(formContext);

        // Set defaults for new records
        if (formContext.ui.getFormType() === 1) { // Create
            this.setDefaults(formContext);
        }

        // Setup field dependencies
        this.setupFieldDependencies(formContext);

        // Lock system fields
        this.lockSystemFields(formContext);

        // Setup field events
        this.setupFieldEvents(formContext);

        // Load related data for existing records
        if (formContext.ui.getFormType() !== 1) {
            this.loadProductionData(formContext);
            this.setupStatusValidation(formContext);
        }

        // Setup real-time calculations
        this.setupCalculations(formContext);

        // Setup production workflow
        this.setupProductionWorkflow(formContext);

        // Initialize production tracking
        this.initializeProductionTracking(formContext);

        console.log("PDG Production Sheet: Form Load Completed");
    },

    onSave: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);

        console.log("PDG Production Sheet: Save Started");

        // Validate required fields
        if (!this.validateProductionSheet(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // Update calculations before save
        this.calculateProductionMetrics(formContext);
        this.updateStatusFields(formContext);
        // Production/Serial numbers are assigned by Dataverse Autonumber

        console.log("PDG Production Sheet: Save Completed");
    },

    // ========= Initialization =========

    setDefaults: function (formContext) {
        try {
            // Set production date to today
            this.setValue(formContext, "pdg_productiondate", new Date());

            // Set default status
            this.setValue(formContext, "pdg_sheetstatus", this.SHEET_STATUS.OPEN);
            this.setValue(formContext, "pdg_progressstatus", this.PROGRESS_STATUS.WP);
            this.setValue(formContext, "pdg_closesheetstatus", this.CLOSE_STATUS.PENDING);

            // Set owner
            var userId = Xrm.Utility.getGlobalContext().userSettings.userId;
            var userName = Xrm.Utility.getGlobalContext().userSettings.userName;

            this.setValue(formContext, "pdg_owner", userName);

            // Serial and Production numbers will be generated server-side (Autonumber)

        } catch (e) {
            console.error("Error setting defaults:", e);
        }
    },

    setupFieldDependencies: function (formContext) {
        try {
            // Finished Item change triggers item data loading
            var finishedItemAttr = formContext.getAttribute("pdg_finisheditemid");
            if (finishedItemAttr) {
                finishedItemAttr.addOnChange(this.onFinishedItemChange.bind(this));
            }

            // Warehouse change affects inventory filtering
            var warehouseAttr = formContext.getAttribute("pdg_warehouseid");
            if (warehouseAttr) {
                warehouseAttr.addOnChange(this.onWarehouseChange.bind(this));
            }

            // Status changes trigger workflow
            var sheetStatusAttr = formContext.getAttribute("pdg_sheetstatus");
            if (sheetStatusAttr) {
                sheetStatusAttr.addOnChange(this.onSheetStatusChange.bind(this));
            }

            var progressStatusAttr = formContext.getAttribute("pdg_progressstatus");
            if (progressStatusAttr) {
                progressStatusAttr.addOnChange(this.onProgressStatusChange.bind(this));
            }

        } catch (e) {
            console.error("Error setting up field dependencies:", e);
        }
    },

    setupFieldEvents: function (formContext) {
        try {
            // Gold weight calculation
            var goldWeightAttr = formContext.getAttribute("pdg_goldweight");
            if (goldWeightAttr) {
                goldWeightAttr.addOnChange(this.calculateCosts.bind(this));
            }

            // Overhead costs calculation
            var overheadsAttr = formContext.getAttribute("pdg_overheads");
            if (overheadsAttr) {
                overheadsAttr.addOnChange(this.calculateCosts.bind(this));
            }

        } catch (e) {
            console.error("Error setting up field events:", e);
        }
    },

    // ========= Field Change Handlers =========

    onFinishedItemChange: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);
        var finishedItem = this.getValue(formContext, "pdg_finisheditemid");

        if (finishedItem && finishedItem.length > 0) {
            var itemId = finishedItem[0].id.replace(/[{}]/g, '');

            // Load item details
            this.loadItemDetails(formContext, itemId);

            // Update estimated delivery based on item lead time
            this.calculateEstimatedDelivery(formContext, itemId);

            // Filter consumption items based on item family
            this.filterConsumptionItems(formContext, itemId);
        }
    },

    onWarehouseChange: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);
        var warehouse = this.getValue(formContext, "pdg_warehouseid");

        if (warehouse && warehouse.length > 0) {
            // Filter inventory records by warehouse
            this.filterInventoryByWarehouse(formContext, warehouse[0].id);

            // Load warehouse-specific production parameters
            this.loadWarehouseParameters(formContext, warehouse[0].id);
        }
    },

    onSheetStatusChange: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);
        var status = this.getValue(formContext, "pdg_sheetstatus");

        if (status === this.SHEET_STATUS.CLOSED) {
            this.handleSheetClosure(formContext);
        } else if (status === this.SHEET_STATUS.OPEN) {
            this.handleSheetReopening(formContext);
        }

        this.updateFieldVisibility(formContext);
    },

    onProgressStatusChange: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);
        var progressStatus = this.getValue(formContext, "pdg_progressstatus");

        if (progressStatus === this.PROGRESS_STATUS.FP) {
            // Mark as ready for closure
            this.setOptionIfExists(formContext, "pdg_closesheetstatus", this.CLOSE_STATUS.READY);

            // Calculate final production efficiency
            this.calculateProductionEfficiency(formContext);

            // Generate finished goods inventory transaction
            this.createFinishedGoodsTransaction(formContext);
        }
    },

    // ========= Data Loading =========

    loadProductionData: function (formContext) {
        var productionId = formContext.data.entity.getId();
        if (!productionId) return;

        try {
            // Load consumption summary
            this.loadConsumptionSummary(formContext, productionId);

            // Load production metrics
            this.loadProductionMetrics(formContext, productionId);

            // Load related transactions
            this.loadRelatedTransactions(formContext, productionId);

        } catch (e) {
            console.error("Error loading production data:", e);
        }
    },

    loadItemDetails: function (formContext, itemId) {
        Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId,
            "?$select=pdg_name,pdg_standardcost,pdg_manufacturingleadtime"
        ).then(
            function (item) {
                // Update form with item details
                if (item.pdg_standardcost) {
                    // Set estimated costs based on item standard cost
                    PDG.ProductionSheet.setValue(formContext, "pdg_totalcost", item.pdg_standardcost);
                }

                if (item.pdg_metalweight) {
                    // Pre-populate gold weight if available
                    PDG.ProductionSheet.setValue(formContext, "pdg_goldweight", item.pdg_metalweight);
                }

                // Display item information notification
                formContext.ui.setFormNotification(
                    "✅ Item details loaded: " + item.pdg_name,
                    "INFO",
                    "item_loaded"
                );

                // Auto-calculate based on loaded data
                PDG.ProductionSheet.calculateCosts(formContext);
            },
            function (error) {
                console.error("Error loading item details:", (error && (error.message || error.errorMessage)) || error);
                formContext.ui.setFormNotification(
                    "⚠️ Could not load item details",
                    "WARNING",
                    "item_load_error"
                );
            }
        );
    },

    loadConsumptionSummary: function (formContext, productionId) {
        var cleanId = productionId.replace(/[{}]/g, '');

        Xrm.WebApi.retrieveMultipleRecords("pdg_consumption",
            "?$select=pdg_consumptiontype,pdg_quantity,pdg_cutting,pdg_manufacturing,pdg_setting,pdg_threading,pdg_overheads" +
            "&$filter=_pdg_productionsheet_value eq " + cleanId
        ).then(
            function (result) {
                var totalMaterialCost = 0;
                var totalLaborCost = 0;
                var totalOverheads = 0;

                result.entities.forEach(function (consumption) {
                    // Sum up different cost components
                    totalLaborCost += (consumption.pdg_cutting || 0) +
                        (consumption.pdg_manufacturing || 0) +
                        (consumption.pdg_setting || 0) +
                        (consumption.pdg_threading || 0);

                    totalOverheads += consumption.pdg_overheads || 0;
                });

                // Update form with calculated totals
                PDG.ProductionSheet.setValue(formContext, "pdg_overheads", totalOverheads);

                // Calculate COGP (Cost of Goods Produced)
                var cogp = totalMaterialCost + totalLaborCost + totalOverheads;
                PDG.ProductionSheet.setValue(formContext, "pdg_cogp", cogp);

                // Display summary notification
                formContext.ui.setFormNotification(
                    "📊 Consumption Summary: Materials: $" + totalMaterialCost.toFixed(2) +
                    ", Labor: $" + totalLaborCost.toFixed(2) +
                    ", Overheads: $" + totalOverheads.toFixed(2),
                    "INFO",
                    "consumption_summary"
                );
            },
            function (error) {
                console.error("Error loading consumption summary:", error);
            }
        );
    },

    loadProductionMetrics: function (formContext, productionId) {
        var cleanId = productionId.replace(/[{}]/g, '');

        // Load efficiency and quality metrics
        Xrm.WebApi.retrieveMultipleRecords("pdg_consumption",
            "?$select=pdg_losspercentage,pdg_lossquantity" +
            "&$filter=_pdg_productionsheet_value eq " + cleanId +
            "&$orderby=createdon desc&$top=10"
        ).then(
            function (result) {
                var totalLossPercentage = 0;
                var recordCount = 0;

                result.entities.forEach(function (consumption) {
                    if (consumption.pdg_losspercentage) {
                        totalLossPercentage += consumption.pdg_losspercentage;
                        recordCount++;
                    }
                });

                if (recordCount > 0) {
                    var avgLossPercentage = totalLossPercentage / recordCount;
                    var efficiency = Math.max(0, 100 - avgLossPercentage);

                    PDG.ProductionSheet.setValue(formContext, "pdg_productionefficiency", efficiency);

                    // Show efficiency notification
                    var efficiencyColor = efficiency >= 95 ? "🟢" : efficiency >= 85 ? "🟡" : "🔴";
                    formContext.ui.setFormNotification(
                        efficiencyColor + " Production Efficiency: " + efficiency.toFixed(1) + "%",
                        efficiency >= 85 ? "INFO" : "WARNING",
                        "efficiency_metric"
                    );
                }
            },
            function (error) {
                console.error("Error loading production metrics:", error);
            }
        );
    },

    loadRelatedTransactions: function (formContext, productionId) {
        var cleanId = productionId.replace(/[{}]/g, '');

        // Load related inventory transactions
        Xrm.WebApi.retrieveMultipleRecords("pdg_inventorytransaction",
            "?$select=pdg_quantity,pdg_totalcost,pdg_referencetype" +
            "&$filter=_pdg_productionsheetid_value eq " + cleanId +
            "&$orderby=createdon desc&$top=5"
        ).then(
            function (result) {
                if (result.entities.length > 0) {
                    var transactionSummary = "📦 Related Transactions: " + result.entities.length + " records";
                    formContext.ui.setFormNotification(
                        transactionSummary,
                        "INFO",
                        "transaction_summary"
                    );
                }
            },
            function (error) {
                console.error("Error loading related transactions:", error);
            }
        );
    },

    // ========= Calculations =========

    calculateCosts: function (executionContext) {
        var formContext = PDG.ProductionSheet.resolveFormContext(executionContext);

        try {
            var goldWeight = this.getValue(formContext, "pdg_goldweight") || 0;
            var overheads = this.getValue(formContext, "pdg_overheads") || 0;

            // Get current gold price (this would normally come from a price table)
            var currentGoldPrice = 65; // USD per gram - this should be dynamic

            // Calculate material cost
            var materialCost = goldWeight * currentGoldPrice;

            // Calculate total cost
            var totalCost = materialCost + overheads;

            // Update form
            this.setValue(formContext, "pdg_totalcost", totalCost);
            this.setValue(formContext, "pdg_cogp", totalCost);

            // Calculate suggested public price (markup of 40%)
            var suggestedPrice = totalCost * 1.4;
            this.setValue(formContext, "pdg_publicprice", suggestedPrice);

        } catch (e) {
            console.error("Error calculating costs:", e);
        }
    },

    calculateEstimatedDelivery: function (formContext, itemId) {
        Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId,
            "?$select=pdg_manufacturingleadtime"
        ).then(
            function (item) {
                var leadTimeDays = item.pdg_manufacturingleadtime || 7; // Default 7 days
                var productionDate = PDG.ProductionSheet.getValue(formContext, "pdg_productiondate");

                if (productionDate) {
                    var estimatedDelivery = new Date(productionDate);
                    estimatedDelivery.setDate(estimatedDelivery.getDate() + leadTimeDays);

                    PDG.ProductionSheet.setValue(formContext, "pdg_estimateddelivery", estimatedDelivery);
                }
            },
            function (error) {
                console.error("Error calculating estimated delivery:", error);
            }
        );
    },

    calculateProductionEfficiency: function (formContext) {
        var productionId = formContext.data.entity.getId();
        if (!productionId) return;

        var cleanId = productionId.replace(/[{}]/g, '');

        // Calculate efficiency based on actual vs planned metrics
        Xrm.WebApi.retrieveMultipleRecords("pdg_consumption",
            "?$select=pdg_quantity,pdg_lossquantity" +
            "&$filter=_pdg_productionsheet_value eq " + cleanId
        ).then(
            function (result) {
                var totalInput = 0;
                var totalLoss = 0;

                result.entities.forEach(function (consumption) {
                    totalInput += consumption.pdg_quantity || 0;
                    totalLoss += consumption.pdg_lossquantity || 0;
                });

                if (totalInput > 0) {
                    var efficiency = ((totalInput - totalLoss) / totalInput) * 100;
                    PDG.ProductionSheet.setValue(formContext, "pdg_productionefficiency", efficiency);

                    // Update status based on efficiency
                    if (efficiency >= 95) {
                        formContext.ui.setFormNotification(
                            "🏆 Excellent production efficiency: " + efficiency.toFixed(1) + "%",
                            "INFO",
                            "efficiency_excellent"
                        );
                    } else if (efficiency < 80) {
                        formContext.ui.setFormNotification(
                            "⚠️ Low production efficiency: " + efficiency.toFixed(1) + "%. Review processes.",
                            "WARNING",
                            "efficiency_low"
                        );
                    }
                }
            },
            function (error) {
                console.error("Error calculating production efficiency:", error);
            }
        );
    },

    // ========= Workflow Management =========

    handleSheetClosure: function (formContext) {
        try {
            // Set closure information
            var currentUser = Xrm.Utility.getGlobalContext().userSettings;
            var currentDate = new Date();

            this.setValue(formContext, "pdg_closeddate", currentDate);
            this.setValue(formContext, "pdg_closesheetstatus", this.CLOSE_STATUS.COMPLETED);

            // Set closed by user
            this.setValue(formContext, "pdg_closedby", [{
                id: this.guidClean(currentUser.userId),
                entityType: "systemuser",
                name: currentUser.userName
            }]);

            // Lock all fields except system fields
            this.lockProductionFields(formContext, true);

            // Generate completion notification
            formContext.ui.setFormNotification(
                "✅ Production sheet closed successfully on " + currentDate.toLocaleDateString(),
                "INFO",
                "sheet_closed"
            );

            // Trigger post-closure processes
            this.postClosureProcesses(formContext);

        } catch (e) {
            console.error("Error handling sheet closure:", e);
        }
    },

    handleSheetReopening: function (formContext) {
        try {
            // Set reopening information
            var currentUser = Xrm.Utility.getGlobalContext().userSettings;
            var currentDate = new Date();

            this.setValue(formContext, "pdg_reopeneddate", currentDate);
            this.setValue(formContext, "pdg_closesheetstatus", this.CLOSE_STATUS.PENDING);

            // Set reopened by user
            this.setValue(formContext, "pdg_reopenedby", [{
                id: this.guidClean(currentUser.userId),
                entityType: "systemuser",
                name: currentUser.userName
            }]);

            // Unlock fields for editing
            this.lockProductionFields(formContext, false);

            // Clear closure information
            this.setValue(formContext, "pdg_closeddate", null);
            this.setValue(formContext, "pdg_closedby", null);

            formContext.ui.setFormNotification(
                "🔄 Production sheet reopened for editing",
                "INFO",
                "sheet_reopened"
            );

        } catch (e) {
            console.error("Error handling sheet reopening:", e);
        }
    },

    postClosureProcesses: function (formContext) {
        var productionId = formContext.data.entity.getId();
        if (!productionId) return;

        // Create finished goods inventory transaction
        this.createFinishedGoodsTransaction(formContext);

        // Update item costs if needed
        this.updateItemCosts(formContext);

        // Generate production completion report
        this.generateCompletionReport(formContext);
    },

    createFinishedGoodsTransaction: function (formContext) {
        try {
            var finishedItem = this.getValue(formContext, "pdg_finisheditemid");
            var warehouse = this.getValue(formContext, "pdg_warehouseid");
            var productionNumber = this.getValue(formContext, "pdg_productionnumber");
            var cogp = this.getValue(formContext, "pdg_cogp");

            if (!finishedItem || !warehouse) {
                console.warn("Missing required data for finished goods transaction");
                return;
            }

            // This would normally create an inventory transaction record
            // For demo purposes, we'll show a notification
            formContext.ui.setFormNotification(
                "📦 Finished goods transaction created for " + finishedItem[0].name,
                "INFO",
                "finished_goods_created"
            );

        } catch (e) {
            console.error("Error creating finished goods transaction:", e);
        }
    },

    // ========= Validation =========

    validateProductionSheet: function (formContext) {
        var isValid = true;
        var isCreate = formContext && formContext.ui && formContext.ui.getFormType && (formContext.ui.getFormType() === 1);
        var errors = [];

        // Check required fields
        if (!this.getValue(formContext, "pdg_finisheditemid")) {
            errors.push("Finished Item is required");
            isValid = false;
        }

        if (!this.getValue(formContext, "pdg_warehouseid")) {
            errors.push("Warehouse is required");
            isValid = false;
        }

        if (!this.getValue(formContext, "pdg_productiondate")) {
            errors.push("Production Date is required");
            isValid = false;
        }

        // Serial Number: if using Autonumber, allow empty on Create; require on Update after server assigns it
        var serialNumber = this.getValue(formContext, "pdg_serialnumber");
        var hasSerial = (serialNumber !== null && serialNumber !== undefined && String(serialNumber).trim() !== "");
        if (!isCreate && !hasSerial) {
            errors.push("Serial Number is required");
            isValid = false;
        }

        // Business logic validation
        var sheetStatus = this.getValue(formContext, "pdg_sheetstatus");
        var progressStatus = this.getValue(formContext, "pdg_progressstatus");

        if (sheetStatus === this.SHEET_STATUS.CLOSED && progressStatus !== this.PROGRESS_STATUS.FP) {
            errors.push("Cannot close sheet until production is finished");
            isValid = false;
        }

        // Show errors if any
        if (!isValid) {
            var errorMessage = "❌ Validation Errors:\n" + errors.join("\n");
            Xrm.Navigation.openAlertDialog({
                confirmButtonLabel: "OK",
                text: errorMessage,
                title: "Production Sheet Validation"
            });
        }

        return isValid;
    },

    // ========= Utility Functions =========

    setupCalculations: function (formContext) {
        // Setup auto-refresh for real-time calculations
        if (formContext.ui.getFormType() !== 1) { // Not create mode
            this.refreshCalculations(formContext);
        }
    },

    setupProductionWorkflow: function (formContext) {
        // Setup workflow notifications and status updates
        var sheetStatus = this.getValue(formContext, "pdg_sheetstatus");
        this.updateFieldVisibility(formContext);
        this.updateStatusNotifications(formContext);
    },

    initializeProductionTracking: function (formContext) {
        // Initialize production tracking features
        this.setupConsumptionTracking(formContext);
        this.setupQualityTracking(formContext);
        this.setupCostTracking(formContext);
    },

    setupConsumptionTracking: function (formContext) {
        // Filter consumption subgrid based on production sheet (only if supported)
        var gridCtrl = formContext.getControl("consumptionsubgrid");
        if (!gridCtrl) { return; }

        var productionId = formContext.data.entity.getId();
        if (!productionId) { return; }

        var cleanId = productionId.replace(/[{}]/g, '');
        var customFilter = "<filter type='and'>" +
            "<condition attribute='pdg_productionsheet' operator='eq' value='" + cleanId + "' />" +
            "</filter>";

        try {
            var grid = (typeof gridCtrl.getGrid === 'function') ? gridCtrl.getGrid() : null;
            var applyFilterFn = null;

            // Some clients expose setFilterXml on the control, others on the underlying grid. Many do not support it at all.
            if (typeof gridCtrl.setFilterXml === 'function') {
                applyFilterFn = function () { gridCtrl.setFilterXml(customFilter); };
            } else if (grid && typeof grid.setFilterXml === 'function') {
                applyFilterFn = function () { grid.setFilterXml(customFilter); };
            }

            if (applyFilterFn) {
                var safeApply = function () {
                    try { applyFilterFn(); } catch (e) { console.warn('Could not apply subgrid filter:', e); }
                };

                if (grid && typeof grid.addOnLoad === 'function') {
                    grid.addOnLoad(safeApply);
                }
                safeApply();
                if (typeof gridCtrl.refresh === 'function') { gridCtrl.refresh(); }
            } else {
                console.warn('Subgrid filtering via setFilterXml is not supported in this client. Consider using a custom view filtered by FetchXML.');
            }
        } catch (e) {
            console.warn('Error initializing consumption subgrid filtering:', e);
        }
    },

    setupQualityTracking: function (formContext) {
        // Setup quality control tracking
        var progressStatus = this.getValue(formContext, "pdg_progressstatus");
        if (progressStatus === this.PROGRESS_STATUS.FP) {
            formContext.ui.setFormNotification(
                "🔍 Quality control required for finished production",
                "INFO",
                "quality_control"
            );
        }
    },

    setupCostTracking: function (formContext) {
        // Setup cost variance tracking
        var totalCost = this.getValue(formContext, "pdg_totalcost");
        var cogp = this.getValue(formContext, "pdg_cogp");

        if (totalCost && cogp && Math.abs(totalCost - cogp) > (totalCost * 0.1)) {
            formContext.ui.setFormNotification(
                "⚠️ Significant cost variance detected between estimated and actual costs",
                "WARNING",
                "cost_variance"
            );
        }
    },

    setupStatusValidation: function (formContext) {
        var sheetStatus = this.getValue(formContext, "pdg_sheetstatus");
        if (sheetStatus === this.SHEET_STATUS.CLOSED) {
            this.lockProductionFields(formContext, true);
        }
    },

    updateFieldVisibility: function (formContext) {
        var sheetStatus = this.getValue(formContext, "pdg_sheetstatus");
        var isClosed = (sheetStatus === this.SHEET_STATUS.CLOSED);

        // Show/hide closure fields based on status
        this.setControlVisible(formContext, "pdg_closedby", isClosed);
        this.setControlVisible(formContext, "pdg_closeddate", isClosed);

        // Show reopening fields if sheet was reopened
        var reopenedDate = this.getValue(formContext, "pdg_reopeneddate");
        this.setControlVisible(formContext, "pdg_reopenedby", reopenedDate !== null);
        this.setControlVisible(formContext, "pdg_reopeneddate", reopenedDate !== null);
    },

    updateStatusNotifications: function (formContext) {
        var sheetStatus = this.getValue(formContext, "pdg_sheetstatus");
        var progressStatus = this.getValue(formContext, "pdg_progressstatus");

        var statusText = "";
        var notificationType = "INFO";

        if (sheetStatus === this.SHEET_STATUS.OPEN) {
            if (progressStatus === this.PROGRESS_STATUS.WP) {
                statusText = "🔄 Production in progress";
            } else {
                statusText = "✅ Production finished - Ready for closure";
            }
        } else if (sheetStatus === this.SHEET_STATUS.CLOSED) {
            statusText = "🔒 Production sheet closed";
        } else if (sheetStatus === this.SHEET_STATUS.CANCELLED) {
            statusText = "❌ Production cancelled";
            notificationType = "ERROR";
        }

        if (statusText) {
            formContext.ui.setFormNotification(statusText, notificationType, "status_update");
        }
    },

    lockProductionFields: function (formContext, lock) {
        // Lock/unlock production fields based on status
        var fieldsToLock = [
            "pdg_finisheditemid",
            "pdg_warehouseid",
            "pdg_productiondate",
            "pdg_goldweight",
            "pdg_overheads",
            "pdg_worksheetnumber",
            "pdg_worksheettype"
        ];

        fieldsToLock.forEach(function (fieldName) {
            PDG.ProductionSheet.setControlDisabled(formContext, fieldName, lock);
        });
    },

    lockSystemFields: function (formContext) {
        // Always lock system-calculated fields
        this.setControlDisabled(formContext, "pdg_productionnumber", true);
        this.setControlDisabled(formContext, "pdg_totalcost", true);
        this.setControlDisabled(formContext, "pdg_cogp", true);
        this.setControlDisabled(formContext, "pdg_productionefficiency", true);
        this.setControlDisabled(formContext, "pdg_closedby", true);
        this.setControlDisabled(formContext, "pdg_closeddate", true);
        this.setControlDisabled(formContext, "pdg_reopenedby", true);
        this.setControlDisabled(formContext, "pdg_reopeneddate", true);
        this.setControlDisabled(formContext, "pdg_owner", true);
    },

    generateProductionNumber: function (formContext) {
        // Generate auto-number for production
        var currentDate = new Date();
        var year = currentDate.getFullYear().toString().substr(-2);
        var month = ("0" + (currentDate.getMonth() + 1)).slice(-2);
        var random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

        var productionNumber = "PROD" + year + month + random;
        this.setValue(formContext, "pdg_productionnumber", productionNumber);
    },

    generateSerialNumber: function (formContext) {
        // Generate unique serial number
        var timestamp = Date.now().toString().substr(-8);
        var serialNumber = "PS" + timestamp;
        this.setValue(formContext, "pdg_serialnumber", serialNumber);
    },

    refreshCalculations: function (formContext) {
        // Refresh all calculations
        this.calculateCosts(formContext);
        this.calculateProductionEfficiency(formContext);
    },

    updateCalculatedFields: function (formContext) {
        // Update all calculated fields
        this.calculateProductionMetrics(formContext);
        this.updateStatusFields(formContext);
    },

    calculateProductionMetrics: function (formContext) {
        // Calculate key production metrics
        this.calculateCosts(formContext);
        this.calculateProductionEfficiency(formContext);
    },

    updateStatusFields: function (formContext) {
        // Update status-related fields
        var progressStatus = this.getValue(formContext, "pdg_progressstatus");
        if (progressStatus === this.PROGRESS_STATUS.FP) {
            this.setOptionIfExists(formContext, "pdg_closesheetstatus", this.CLOSE_STATUS.READY);
        }
    },

    // ========= Helper Functions =========

    getValue: function (formContext, fieldName) {
        var attr = formContext.getAttribute(fieldName);
        return attr ? attr.getValue() : null;
    },

    setValue: function (formContext, fieldName, value) {
        var attr = formContext.getAttribute(fieldName);
        if (attr) {
            attr.setValue(value);
        }
    },

    // Safely set an option-set value only if present in options
    setOptionIfExists: function (formContext, fieldName, value) {
        if (value === undefined || value === null) { return; }
        var attr = formContext.getAttribute(fieldName);
        if (!attr || typeof attr.getOptions !== 'function') { return; }
        var options = attr.getOptions() || [];
        for (var i = 0; i < options.length; i++) {
            if (options[i] && options[i].value === value) {
                attr.setValue(value);
                return;
            }
        }
        console.warn('Option value not found for', fieldName, value);
    },

    setControlDisabled: function (formContext, fieldName, disabled) {
        var ctrl = formContext.getControl(fieldName);
        if (ctrl) {
            ctrl.setDisabled(disabled);
        }
    },

    setControlVisible: function (formContext, fieldName, visible) {
        var ctrl = formContext.getControl(fieldName);
        if (ctrl) {
            ctrl.setVisible(visible);
        }
    },

    guidClean: function (guid) {
        return guid ? guid.replace(/[{}]/g, '') : '';
    },

    // Resolve environment-specific option values by matching labels
    resolveOptionValues: function (formContext) {
        var self = this;
        function find(field, labels) {
            var attr = formContext.getAttribute(field);
            if (!attr || typeof attr.getOptions !== 'function') { return null; }
            var options = attr.getOptions() || [];
            var lower = labels.map(function (l) { return (l || '').toLowerCase(); });
            for (var i = 0; i < options.length; i++) {
                var o = options[i];
                if (!o) continue;
                var text = (o.text || '').toLowerCase();
                if (lower.indexOf(text) >= 0) return o.value;
            }
            return null;
        }

        var openVal = find('pdg_sheetstatus', ['Open']);
        var closedVal = find('pdg_sheetstatus', ['Closed']);
        var cancelVal = find('pdg_sheetstatus', ['Cancelled', 'Canceled']);
        if (openVal !== null) self.SHEET_STATUS.OPEN = openVal;
        if (closedVal !== null) self.SHEET_STATUS.CLOSED = closedVal;
        if (cancelVal !== null) self.SHEET_STATUS.CANCELLED = cancelVal;

        var wpVal = find('pdg_progressstatus', ['WP', 'Work in Progress', 'WIP']);
        var fpVal = find('pdg_progressstatus', ['FP', 'Finished Progress', 'Finished']);
        if (wpVal !== null) self.PROGRESS_STATUS.WP = wpVal;
        if (fpVal !== null) self.PROGRESS_STATUS.FP = fpVal;

        var readyVal = find('pdg_closesheetstatus', ['Ready', 'Open']);
        var pendVal = find('pdg_closesheetstatus', ['Pending']);
        var compVal = find('pdg_closesheetstatus', ['Completed', 'Closed']);
        if (readyVal !== null) self.CLOSE_STATUS.READY = readyVal;
        if (pendVal !== null) self.CLOSE_STATUS.PENDING = pendVal;
        if (compVal !== null) self.CLOSE_STATUS.COMPLETED = compVal;
    },

    // ========= Advanced Features =========

    generateCompletionReport: function (formContext) {
        var productionNumber = this.getValue(formContext, "pdg_productionnumber");
        var finishedItem = this.getValue(formContext, "pdg_finisheditemid");
        var efficiency = this.getValue(formContext, "pdg_productionefficiency");
        var cogp = this.getValue(formContext, "pdg_cogp");

        var reportData = {
            productionNumber: productionNumber,
            finishedItem: finishedItem ? finishedItem[0].name : "Unknown",
            efficiency: efficiency ? efficiency.toFixed(1) + "%" : "Not calculated",
            finalCost: cogp ? "$" + cogp.toFixed(2) : "Not calculated",
            completedDate: new Date().toLocaleDateString()
        };

        console.log("Production Completion Report:", reportData);

        formContext.ui.setFormNotification(
            "📊 Production completion report generated for " + reportData.productionNumber,
            "INFO",
            "completion_report"
        );
    },

    updateItemCosts: function (formContext) {
        var finishedItem = this.getValue(formContext, "pdg_finisheditemid");
        var cogp = this.getValue(formContext, "pdg_cogp");

        if (finishedItem && cogp) {
            // This would update the item's actual cost based on production
            console.log("Updating item costs for:", finishedItem[0].name, "with COGP:", cogp);
        }
    },

    filterConsumptionItems: function (formContext, itemId) {
        // Filter consumption items based on finished item family
        var consumptionGrid = formContext.getControl("consumptionsubgrid");
        if (consumptionGrid) {
            // Apply intelligent filtering for consumption items
            console.log("Filtering consumption items for item:", itemId);
        }
    },

    filterInventoryByWarehouse: function (formContext, warehouseId) {
        // Filter inventory lookups by selected warehouse
        console.log("Filtering inventory by warehouse:", warehouseId);
    },

    loadWarehouseParameters: function (formContext, warehouseId) {
        // Load warehouse-specific production parameters
        console.log("Loading warehouse parameters for:", warehouseId);
    }
};

// ========= Global Event Handlers =========
// These functions are called by the form events

function PDG_ProductionSheet_OnLoad(executionContext) {
    PDG.ProductionSheet.onLoad(executionContext);
}

function PDG_ProductionSheet_OnSave(executionContext) {
    PDG.ProductionSheet.onSave(executionContext);
}

function PDG_ProductionSheet_FinishedItem_OnChange(executionContext) {
    PDG.ProductionSheet.onFinishedItemChange(executionContext);
}

function PDG_ProductionSheet_Warehouse_OnChange(executionContext) {
    PDG.ProductionSheet.onWarehouseChange(executionContext);
}

function PDG_ProductionSheet_SheetStatus_OnChange(executionContext) {
    PDG.ProductionSheet.onSheetStatusChange(executionContext);
}

function PDG_ProductionSheet_ProgressStatus_OnChange(executionContext) {
    PDG.ProductionSheet.onProgressStatusChange(executionContext);
}

function PDG_ProductionSheet_Calculate_OnChange(executionContext) {
    PDG.ProductionSheet.calculateCosts(executionContext);
}
