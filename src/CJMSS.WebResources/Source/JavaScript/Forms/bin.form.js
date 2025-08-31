/* === PDG Bin Form JavaScript — v6 Non-Blocking Hints Implementation === */
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
            this.setupNonBlockingHints(formContext);

            if (formContext.ui.getFormType() !== 1) { // Not create mode
                this.loadBinDetails(formContext);
            }

            // Initial calculations
            this.runInitialCalculations(formContext);

            // Enhanced bin code management
            this.setupBinCodeManagement(formContext);

            // Simplified barcode/QR code management
            this.setupBarcodeManagement(formContext);

            // Periodic refresh
            this.setupAutoRefresh(formContext);

            // Inject enhanced styles
            this.injectCapacityStatusStyles();

            console.log("PDG Bin form loaded successfully");
        } catch (e) {
            console.error("Error in Bin onLoad:", e);
            this.showFormNotification(formContext, "Error loading form: " + e.message, "ERROR", "load_error");
        }
    },

    onSave: function (executionContext) {
        var formContext = executionContext.getFormContext();

        try {
            // FIRST: Clear all temporary control notifications to prevent save interference
            this.clearAllControlNotifications(formContext);

            // SECOND: Generate missing codes
            this.generateMissingCodes(formContext);

            // THIRD: Update calculations
            this.validateAndUpdateLocationPath(formContext);
            this.calculateVolume(formContext);
            this.updateCapacityPercentages(formContext);
            this.updateLocationPath(formContext);
            this.updateCapacityStatusDisplay(formContext);

            // FOURTH: Run lightweight validation (only critical business rules)
            if (!this.validateCriticalFields(formContext)) {
                executionContext.getEventArgs().preventDefault();
                return false;
            }

            if (formContext.PDG_RefreshInterval) {
                clearInterval(formContext.PDG_RefreshInterval);
            }

            console.log("PDG Bin form saved successfully");
            return true;
        } catch (e) {
            console.error("Error in Bin onSave:", e);
            this.showFormNotification(formContext, "Error saving form: " + e.message, "ERROR", "save_error");
            executionContext.getEventArgs().preventDefault();
            return false;
        }
    },

    // ========= Non-Blocking Hint System =========

    setupNonBlockingHints: function (formContext) {
        try {
            // Set up helpful hints that don't block form submission
            if (formContext.ui.getFormType() === 1) { // Create mode
                this.setControlHint("pdg_bincode", "Enter custom code or leave empty to auto-generate when selecting warehouse", formContext);
            }

            this.setControlHint("pdg_barcode", "Auto-generated from bin code - scannable by warehouse devices", formContext);
            this.setControlHint("pdg_qrcode", "Contains full bin details - scan with mobile device", formContext);

            // Set read-only states without validation flags
            this.setControlReadOnly("pdg_barcode", true, formContext);
            this.setControlReadOnly("pdg_qrcode", true, formContext);

            if (formContext.ui.getFormType() !== 1) { // Edit mode
                this.setControlReadOnly("pdg_bincode", true, formContext);
                this.setControlHint("pdg_bincode", "Bin code cannot be modified after creation", formContext);
            }

        } catch (e) {
            console.warn("Error setting up non-blocking hints:", e);
        }
    },

    // Helper: Set informational hint on control without blocking validation
    setControlHint: function (fieldName, message, formContext) {
        try {
            var control = formContext.getControl(fieldName);
            if (control && typeof control.setNotification === "function") {
                // Clear any existing notifications first
                control.clearNotification();
                // Set info-level notification that won't block save
                control.setNotification(message, "INFORMATION");
            }
        } catch (e) {
            console.warn("Error setting control hint for " + fieldName + ":", e);
        }
    },

    // Helper: Set control read-only state
    setControlReadOnly: function (fieldName, isReadOnly, formContext) {
        try {
            var control = formContext.getControl(fieldName);
            if (control) {
                control.setDisabled(isReadOnly);
            }
        } catch (e) {
            console.warn("Error setting read-only state for " + fieldName + ":", e);
        }
    },

    // Helper: Clear all control notifications before save
    clearAllControlNotifications: function (formContext) {
        try {
            var fieldsWithNotifications = [
                "pdg_bincode", "pdg_barcode", "pdg_qrcode",
                "pdg_capacitypercentage", "pdg_weightpercentage",
                "pdg_volume", "pdg_locationpath", "pdg_warehousename"
            ];

            fieldsWithNotifications.forEach(function (fieldName) {
                var control = formContext.getControl(fieldName);
                if (control && typeof control.clearNotification === "function") {
                    control.clearNotification();
                }
            });

            console.log("Cleared all control notifications before save");
        } catch (e) {
            console.warn("Error clearing control notifications:", e);
        }
    },

    // Helper: Show form-level notifications (for important messages only)
    showFormNotification: function (formContext, message, level, uniqueId, autoClear) {
        try {
            if (autoClear === undefined) autoClear = true;
            formContext.ui.setFormNotification(message, level, uniqueId);
            if (autoClear) {
                var timeout = level === "ERROR" ? 8000 : 4000;
                var self = this;
                setTimeout(function () {
                    formContext.ui.clearFormNotification(uniqueId);
                }, timeout);
            }
        } catch (e) {
            console.warn("Error showing form notification:", e);
        }
    },

    // ========= Lightweight Validation (Critical Only) =========

    validateCriticalFields: function (formContext) {
        var ok = true;
        try {
            // Only validate truly critical business rules - not informational fields

            var binCode = formContext.getAttribute("pdg_bincode");
            if (!binCode || !binCode.getValue() || binCode.getValue().trim() === "") {
                this.showFormNotification(formContext, "Bin Code is required", "ERROR", "validation_bincode", false);
                ok = false;
            }

            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var wh = warehouse ? warehouse.getValue() : null;
            if (!wh || !wh.length) {
                this.showFormNotification(formContext, "Warehouse is required", "ERROR", "validation_warehouse", false);
                ok = false;
            }

            // Business logic validation
            var capacity = formContext.getAttribute("pdg_capacity");
            var currentOccupancy = formContext.getAttribute("pdg_currentoccupancy");
            var cap = capacity ? capacity.getValue() : 0;
            var occ = currentOccupancy ? currentOccupancy.getValue() : 0;
            if (cap && cap > 0 && occ > cap) {
                this.showFormNotification(formContext, "Current occupancy cannot exceed total capacity", "ERROR", "validation_capacity", false);
                ok = false;
            }

            var weightCapacity = formContext.getAttribute("pdg_weightcapacity");
            var currentWeight = formContext.getAttribute("pdg_currentweight");
            var wcap = weightCapacity ? weightCapacity.getValue() : 0;
            var wcur = currentWeight ? currentWeight.getValue() : 0;
            if (wcap && wcap > 0 && wcur > wcap) {
                this.showFormNotification(formContext, "Current weight cannot exceed weight capacity", "ERROR", "validation_weight", false);
                ok = false;
            }

        } catch (e) {
            console.warn("Error in critical validation:", e);
            ok = false;
        }
        return ok;
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
            ["pdg_capacitypercentage", "pdg_weightpercentage", "pdg_volume", "pdg_locationpath"]
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

    // ========= Enhanced Field Events =========

    setupFieldEvents: function (formContext) {
        try {
            var self = this;
            console.log("Setting up field events for real-time calculations...");

            this.setupFieldEventWithValidation(formContext, ["pdg_length", "pdg_width", "pdg_height"],
                function () { self.calculateVolumeRealTime(formContext); }, "Volume calculation");

            this.setupFieldEventWithValidation(formContext, ["pdg_capacity", "pdg_currentoccupancy"],
                function () { self.updateCapacityPercentageRealTime(formContext); }, "Capacity percentage");

            this.setupFieldEventWithValidation(formContext, ["pdg_weightcapacity", "pdg_currentweight"],
                function () { self.updateWeightPercentageRealTime(formContext); }, "Weight percentage");

            this.setupFieldEventWithValidation(formContext, ["pdg_aisle", "pdg_row", "pdg_shelf", "pdg_position", "pdg_zone"],
                function () { self.updateLocationPath(formContext); }, "Location path");

            this.setupLookupFieldEvent(formContext, "pdg_warehouseid",
                function (executionContext) { self.onWarehouseChange(executionContext); });

            this.setupFieldEventWithValidation(formContext, ["pdg_bincode"],
                function (executionContext) { self.onBinCodeChange(executionContext); }, "Bin code");

            this.setupFieldEventWithValidation(formContext, ["pdg_capacityuomid"],
                function () { self.updateCapacityPercentageRealTime(formContext); }, "Capacity UOM");

            this.setupDebouncedCalculations(formContext);

            console.log("Field events setup completed successfully");
        } catch (e) {
            console.error("Error setting up field events:", e);
        }
    },

    setupFieldEventWithValidation: function (formContext, fieldNames, handler, description) {
        var self = this;
        var successCount = 0;

        fieldNames.forEach(function (fieldName) {
            try {
                var attribute = formContext.getAttribute(fieldName);

                if (attribute && typeof attribute.addOnChange === "function") {
                    var wrappedHandler = function () {
                        try {
                            handler();
                        } catch (e) {
                            console.error("Error in " + description + " handler for field " + fieldName + ":", e);
                        }
                    };

                    attribute.addOnChange(wrappedHandler);
                    successCount++;
                    console.log("Successfully attached " + description + " handler to field: " + fieldName);
                } else {
                    console.warn("Field " + fieldName + " not found or doesn't support onChange events");
                }
            } catch (e) {
                console.error("Error attaching handler to field " + fieldName + ":", e);
            }
        });

        if (successCount === 0) {
            console.warn("No handlers could be attached for " + description);
        }
    },

    setupLookupFieldEvent: function (formContext, fieldName, handler) {
        try {
            var attribute = formContext.getAttribute(fieldName);
            if (attribute && typeof attribute.addOnChange === "function") {
                attribute.addOnChange(handler);
                console.log("Successfully attached lookup handler to field: " + fieldName);
            } else {
                console.warn("Lookup field " + fieldName + " not found or doesn't support onChange events");
            }
        } catch (e) {
            console.error("Error attaching lookup handler to field " + fieldName + ":", e);
        }
    },

    setupDebouncedCalculations: function (formContext) {
        var self = this;
        var debounceTimers = {};

        if (!this._originalCalcVolume) {
            this._originalCalcVolume = this.calculateVolumeRealTime;
        }

        this.calculateVolumeRealTime = function (fc) {
            clearTimeout(debounceTimers.volume);
            debounceTimers.volume = setTimeout(function () {
                self._originalCalcVolume.call(self, fc);
            }, 300);
        };
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

    // ========= Enhanced Bin Code Management =========

    setupBinCodeManagement: function (formContext) {
        try {
            // Handled in setupNonBlockingHints - no additional setup needed
            console.log("Bin code management configured with non-blocking hints");
        } catch (e) {
            console.warn("Error setting up bin code management:", e);
        }
    },

    onWarehouseChange: function (executionContext) {
        var formContext = executionContext.getFormContext();
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var wh = warehouse ? warehouse.getValue() : null;

            this.updateLocationPath(formContext);

            if (wh && wh.length) {
                if (formContext.ui.getFormType() === 1) {
                    var binCode = formContext.getAttribute("pdg_bincode");
                    if (binCode && !binCode.getValue()) {
                        var generatedCode = this.generateBinCodeImmediate(formContext);
                        if (generatedCode) {
                            this.setControlHint("pdg_bincode", "Auto-generated: " + generatedCode + " (you can edit this)", formContext);
                            this.generateBarcode(formContext);
                        }
                    }
                }

                this.showFormNotification(formContext, "Warehouse selected: " + wh[0].name, "INFO", "warehouse_selected");
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
                this.updateControlHint("pdg_bincode", "Bin code: " + val, formContext);
            }
        } catch (e) {
            console.warn("Error in onBinCodeChange:", e);
        }
    },

    // Helper: Update control hint without clearing other notifications
    updateControlHint: function (fieldName, message, formContext) {
        try {
            var control = formContext.getControl(fieldName);
            if (control && typeof control.setNotification === "function") {
                control.clearNotification();
                control.setNotification(message, "INFORMATION");
            }
        } catch (e) {
            console.warn("Error updating control hint for " + fieldName + ":", e);
        }
    },

    generateBinCodeImmediate: function (formContext) {
        try {
            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var binCode = formContext.getAttribute("pdg_bincode");
            var wh = warehouse ? warehouse.getValue() : null;

            if (wh && wh.length && binCode) {
                var warehouseCode = wh[0].name.substring(0, 2).toUpperCase();
                var timestamp = new Date().getTime().toString().slice(-4);
                var randomNum = Math.floor(Math.random() * 100).toString().padStart(2, '0');

                var generatedCode = warehouseCode + "-" + timestamp + "-" + randomNum;

                binCode.setValue(generatedCode);
                console.log("Generated bin code: " + generatedCode);

                return generatedCode;
            }
        } catch (e) {
            console.warn("Error in immediate bin code generation:", e);
        }
        return null;
    },

    // ========= Location Path Auto-Fill Fix =========

    validateAndUpdateLocationPath: function (formContext) {
        try {
            var currentPath = formContext.getAttribute("pdg_locationpath");
            var currentValue = currentPath ? currentPath.getValue() : '';

            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var aisle = formContext.getAttribute("pdg_aisle");
            var row = formContext.getAttribute("pdg_row");
            var shelf = formContext.getAttribute("pdg_shelf");
            var position = formContext.getAttribute("pdg_position");
            var zone = formContext.getAttribute("pdg_zone");

            var parts = [];
            var wh = warehouse && warehouse.getValue();
            if (wh && wh.length) parts.push(wh[0].name);

            var a = aisle && aisle.getValue();
            if (a) parts.push("A:" + a);

            var r = row && row.getValue();
            if (r) parts.push("R:" + r);

            var s = shelf && shelf.getValue();
            if (s) parts.push("S:" + s);

            var p = position && position.getValue();
            if (p) parts.push("P:" + p);

            var z = zone && zone.getValue();
            if (z) parts.push("Z:" + z);

            var expectedPath = parts.join(" > ");

            if (currentValue !== expectedPath) {
                if (currentPath) {
                    currentPath.setValue(expectedPath);
                    formContext._pdg_locationPath = expectedPath;
                }
                this.setControlHint("pdg_locationpath", "Auto-updated: " + expectedPath, formContext);
            }
        } catch (e) {
            console.warn("Error validating location path:", e);
        }
    },

    // ========= Enhanced Capacity Status Display =========

    updateCapacityStatusDisplay: function (formContext) {
        try {
            var statusField = formContext.getAttribute("pdg_warehousename");

            if (!statusField) return;

            var capacityInfo = this.getCapacityInfo(formContext);
            var maxUtilization = capacityInfo.maxUtilization;

            var statusText = "";
            var statusClass = "";

            if (maxUtilization === 0) {
                statusText = "Empty - Available";
                statusClass = "pdg-status-available";
            } else if (maxUtilization < 50) {
                statusText = "Available (" + maxUtilization.toFixed(1) + "% used)";
                statusClass = "pdg-status-available";
            } else if (maxUtilization < 80) {
                statusText = "Moderate (" + maxUtilization.toFixed(1) + "% used)";
                statusClass = "pdg-status-moderate";
            } else if (maxUtilization < 95) {
                statusText = "High (" + maxUtilization.toFixed(1) + "% used)";
                statusClass = "pdg-status-high";
            } else {
                statusText = "Critical (" + maxUtilization.toFixed(1) + "% used)";
                statusClass = "pdg-status-critical";
            }

            statusField.setValue(statusText);

            setTimeout(function () {
                var element = document.querySelector('[data-id="pdg_warehousename"] input, [data-id="pdg_warehousename"] .ms-crm-Field-Data-Print');

                if (element) {
                    element.classList.remove("pdg-status-available", "pdg-status-moderate", "pdg-status-high", "pdg-status-critical");
                    element.classList.add(statusClass);
                }
            }, 100);

        } catch (e) {
            console.warn("Error updating capacity status display:", e);
        }
    },

    injectCapacityStatusStyles: function () {
        try {
            if (document.getElementById('pdg-capacity-status-styles')) return;

            var style = document.createElement('style');
            style.id = 'pdg-capacity-status-styles';
            style.textContent = `
                .pdg-status-available { 
                    color: #28a745 !important; 
                    font-weight: bold !important;
                    background-color: #d4edda !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                }
                .pdg-status-moderate { 
                    color: #856404 !important; 
                    font-weight: bold !important;
                    background-color: #fff3cd !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                }
                .pdg-status-high { 
                    color: #e0a800 !important; 
                    font-weight: bold !important;
                    background-color: #fff3cd !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                }
                .pdg-status-critical { 
                    color: #721c24 !important; 
                    font-weight: bold !important;
                    background-color: #f8d7da !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                }
                .pdg-barcode-field { 
                    font-family: monospace !important;
                    font-size: 14px !important;
                    font-weight: bold !important;
                    background-color: #f8f9fa !important;
                    border: 2px solid #28a745 !important;
                }
                .pdg-qrcode-field { 
                    font-family: monospace !important;
                    font-size: 12px !important;
                    background-color: #f8f9fa !important;
                    border: 2px solid #007bff !important;
                }
            `;
            document.head.appendChild(style);
        } catch (e) {
            console.warn("Error injecting capacity status styles:", e);
        }
    },

    // ========= Simplified Barcode/QR Code Management =========

    setupBarcodeManagement: function (formContext) {
        try {
            // Visual styling handled in setupNonBlockingHints
            this.addBarcodeVisualIndicators(formContext);
            console.log("Barcode management configured with non-blocking approach");
        } catch (e) {
            console.warn("Error in setupBarcodeManagement:", e);
        }
    },

    generateMissingCodes: function (formContext) {
        try {
            var binCode = formContext.getAttribute("pdg_bincode");
            var barcode = formContext.getAttribute("pdg_barcode");
            var qrcode = formContext.getAttribute("pdg_qrcode");

            var binValue = binCode ? binCode.getValue() : null;

            if (!binValue && formContext.ui.getFormType() === 1) {
                var warehouse = formContext.getAttribute("pdg_warehouseid");
                var wh = warehouse ? warehouse.getValue() : null;
                if (wh && wh.length) {
                    binValue = this.generateBinCodeImmediate(formContext);
                }
            }

            if (binValue && barcode && !barcode.getValue()) {
                barcode.setValue(binValue);
                this.setControlHint("pdg_barcode", "Generated: " + binValue, formContext);
            }

            if (binValue && qrcode && !qrcode.getValue()) {
                this.generateQRCodeSync(formContext, binValue);
                this.setControlHint("pdg_qrcode", "Generated with bin details", formContext);
            }

        } catch (e) {
            console.warn("Error generating missing codes:", e);
        }
    },

    generateBarcode: function (formContext) {
        try {
            var binCode = formContext.getAttribute("pdg_bincode");
            var code = binCode ? binCode.getValue() : null;
            if (!code) return;

            var barcodeAttr = formContext.getAttribute("pdg_barcode");
            if (barcodeAttr) {
                barcodeAttr.setValue(code);
                this.setControlHint("pdg_barcode", "Updated: " + code, formContext);
            }

            this.generateRichQRCode(formContext, code);

        } catch (e) {
            console.warn("Error generating barcode:", e);
        }
    },

    generateRichQRCode: function (formContext, binCode) {
        try {
            if (!binCode) return;

            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var locationPath = formContext.getAttribute("pdg_locationpath");
            var capacity = formContext.getAttribute("pdg_capacity");
            var currentOccupancy = formContext.getAttribute("pdg_currentoccupancy");

            var wh = warehouse ? warehouse.getValue() : null;
            var warehouseName = wh && wh.length ? wh[0].name : '';

            var qrData = {
                type: "WAREHOUSE_BIN",
                binCode: binCode,
                warehouse: warehouseName,
                location: locationPath ? locationPath.getValue() : '',
                capacity: capacity ? capacity.getValue() : 0,
                occupancy: currentOccupancy ? currentOccupancy.getValue() : 0,
                status: this.getBinStatusText(formContext),
                timestamp: new Date().toISOString()
            };

            var qrcodeAttr = formContext.getAttribute("pdg_qrcode");
            if (qrcodeAttr) {
                qrcodeAttr.setValue(JSON.stringify(qrData, null, 2));
                this.setControlHint("pdg_qrcode", "Updated with current bin details", formContext);
            }

        } catch (e) {
            console.warn("Error generating QR code:", e);
        }
    },

    generateQRCodeSync: function (formContext, binCode) {
        try {
            if (!binCode) return;

            var warehouse = formContext.getAttribute("pdg_warehouseid");
            var wh = warehouse ? warehouse.getValue() : null;
            var warehouseName = wh && wh.length ? wh[0].name : '';

            var qrData = {
                type: "WAREHOUSE_BIN",
                binCode: binCode,
                warehouse: warehouseName,
                timestamp: new Date().toISOString()
            };

            var qrcodeAttr = formContext.getAttribute("pdg_qrcode");
            if (qrcodeAttr) {
                qrcodeAttr.setValue(JSON.stringify(qrData, null, 2));
            }

        } catch (e) {
            console.warn("Error generating QR code sync:", e);
        }
    },

    getBinStatusText: function (formContext) {
        try {
            var capacityInfo = this.getCapacityInfo(formContext);
            var maxUtilization = capacityInfo.maxUtilization;

            if (maxUtilization === 0) return "Empty";
            if (maxUtilization < 50) return "Available";
            if (maxUtilization < 80) return "Moderate";
            if (maxUtilization < 95) return "High";
            return "Critical";
        } catch (e) {
            return "Unknown";
        }
    },

    addBarcodeVisualIndicators: function (formContext) {
        try {
            setTimeout(function () {
                var barcodeField = document.querySelector('[data-id="pdg_barcode"] input');
                var qrField = document.querySelector('[data-id="pdg_qrcode"] input');

                if (barcodeField) {
                    barcodeField.className += ' pdg-barcode-field';
                    barcodeField.title = 'Scannable barcode for warehouse devices';
                }

                if (qrField) {
                    qrField.className += ' pdg-qrcode-field';
                    qrField.title = 'QR code data - scan with mobile device for full bin details';
                }
            }, 500);

        } catch (e) {
            console.warn("Error adding visual indicators:", e);
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

            var cap = this.getNumericValue(capacity);
            var occ = this.getNumericValue(currentOccupancy);

            var pct = 0;
            if (cap > 0) {
                pct = Math.round(((occ / cap) * 100) * 100) / 100;
            }

            out.setValue(pct);
            this.updateCapacityStatus(formContext);

            // Use control hint instead of blocking notification
            this.setControlHint("pdg_capacitypercentage", "Calculated: " + pct.toFixed(1) + "%", formContext);

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

            var cap = this.getNumericValue(weightCapacity);
            var cur = this.getNumericValue(currentWeight);

            var pct = 0;
            if (cap > 0) {
                pct = Math.round(((cur / cap) * 100) * 100) / 100;
            }

            out.setValue(pct);
            this.updateCapacityStatus(formContext);

            // Use control hint instead of blocking notification
            this.setControlHint("pdg_weightpercentage", "Calculated: " + pct.toFixed(1) + "%", formContext);

        } catch (e) {
            console.error("Error updating weight percentage:", e);
        }
    },

    getNumericValue: function (attribute) {
        if (!attribute) return 0;
        var value = attribute.getValue();
        return (value !== null && value !== undefined && !isNaN(value)) ? Number(value) : 0;
    },

    calculateVolumeRealTime: function (formContext) {
        try {
            var L = formContext.getAttribute("pdg_length");
            var W = formContext.getAttribute("pdg_width");
            var H = formContext.getAttribute("pdg_height");
            var out = formContext.getAttribute("pdg_volume");

            if (!out) return;

            var l = this.getNumericValue(L);
            var w = this.getNumericValue(W);
            var h = this.getNumericValue(H);

            var v = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 1e9 : 0;
            out.setValue(v);

            if (v > 0) {
                this.setControlHint("pdg_volume", "Calculated: " + v.toLocaleString() + " m³", formContext);
            }
        } catch (e) {
            console.error("Error calculating volume:", e);
        }
    },

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

            // Only show form notifications for critical capacity issues
            if (maxp >= 95) {
                this.showFormNotification(formContext, "Critical: Bin is at " + maxp.toFixed(1) + "% capacity", "ERROR", "capacity_status");
            } else if (maxp >= 80) {
                this.showFormNotification(formContext, "Warning: Bin is at " + maxp.toFixed(1) + "% capacity", "WARNING", "capacity_status");
            } else {
                // Clear any previous capacity warnings
                formContext.ui.clearFormNotification("capacity_status");
            }

            this.updateCapacityStatusDisplay(formContext);

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
            var zone = formContext.getAttribute("pdg_zone");
            var out = formContext.getAttribute("pdg_locationpath");

            if (!out) return;

            var parts = [];
            var wh = warehouse && warehouse.getValue();
            if (wh && wh.length) parts.push(wh[0].name);

            var a = aisle && aisle.getValue();
            if (a) parts.push("A:" + a);

            var r = row && row.getValue();
            if (r) parts.push("R:" + r);

            var s = shelf && shelf.getValue();
            if (s) parts.push("S:" + s);

            var p = position && position.getValue();
            if (p) parts.push("P:" + p);

            var z = zone && zone.getValue();
            if (z) parts.push("Z:" + z);

            var path = parts.join(" > ");
            out.setValue(path);
            formContext._pdg_locationPath = path;
        } catch (e) {
            console.warn("Error updating location path:", e);
        }
    },

    // ========= Data Loading =========

    runInitialCalculations: function (formContext) {
        try {
            this.calculateVolumeRealTime(formContext);
            this.updateCapacityPercentageRealTime(formContext);
            this.updateWeightPercentageRealTime(formContext);
            this.updateLocationPath(formContext);
            this.updateCapacityStatusDisplay(formContext);

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
            this.showFormNotification(formContext, "Loading current occupancy data...", "INFO", "loading_occupancy");
            var self = this;
            setTimeout(function () {
                formContext.ui.clearFormNotification("loading_occupancy");
                self.updateCapacityPercentages(formContext);
            }, 1000);
        } catch (e) {
            console.warn("Error loading current occupancy:", e);
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
}; // End of PDG.Bin object

// ========= Ribbon Button Functions =========
PDG.Bin.generateBinCodeRibbon = function (primaryControl) {
    try {
        var formContext = primaryControl;
        PDG.Bin.generateBinCodeImmediate(formContext);
        PDG.Bin.showFormNotification(formContext, "Bin code regenerated", "INFO", "ribbon_generated");
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
        PDG.Bin.showFormNotification(formContext, "Percentages recalculated successfully", "INFO", "recalculate_success");
    } catch (e) {
        console.error("Error in recalculatePercentagesRibbon:", e);
    }
};

PDG.Bin.regenerateCodesRibbon = function (primaryControl) {
    try {
        var formContext = primaryControl;
        var barcodeAttr = formContext.getAttribute("pdg_barcode");
        var qrcodeAttr = formContext.getAttribute("pdg_qrcode");

        if (barcodeAttr) barcodeAttr.setValue(null);
        if (qrcodeAttr) qrcodeAttr.setValue(null);

        PDG.Bin.generateMissingCodes(formContext);
        PDG.Bin.showFormNotification(formContext, "Barcode and QR code regenerated", "INFO", "codes_regenerated");
    } catch (e) {
        console.error("Error in regenerateCodesRibbon:", e);
    }
};

// ========= Lookup Filtering Helper =========
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
            handler();
        }
    } catch (e) {
        console.warn("Error setting up bin lookup filtering:", e);
    }
};