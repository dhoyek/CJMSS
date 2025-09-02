/* Enhanced Inventory Form JavaScript - Complete Updated Version */
var PDG = PDG || {};

(function () {
    // ---------- Enhanced Utilities ----------
    function attr(fc, name) { try { return fc.getAttribute(name) || null; } catch (e) { return null; } }
    function ctrl(fc, name) { try { return fc.getControl(name) || null; } catch (e) { return null; } }
    function num(v) { v = (v === null || v === undefined) ? 0 : v; var n = Number(v); return isNaN(n) ? 0 : n; }
    function setIf(fc, name, val) { var a = attr(fc, name); if (a) { try { a.setValue(val); } catch (e) { } } }
    function getLookupId(v) { return v && v[0] && v[0].id ? v[0].id.replace(/[{}]/g, "") : null; }
    function getLookupName(v) { return v && v[0] && v[0].name ? v[0].name : ""; }
    // Track notifications so we can clear them on save; default is persistent
    PDG._notifIds = PDG._notifIds || {};
    function notify(fc, msg, level, id, timeout) {
        try {
            var lvl = (level || "INFO").toUpperCase();
            if (lvl === "INFO" && PDG.Inventory && typeof PDG.Inventory.addSummary === "function") {
                PDG.Inventory.addSummary(fc, msg, id);
                return;
            }
            var nid = id || ("n_" + Date.now());
            fc.ui.setFormNotification(msg, lvl, nid);
            PDG._notifIds[nid] = true;
        } catch (e) { }
    }
    function clear(fc, id) { try { fc.ui.clearFormNotification(id); } catch (e) { } }
    function now() { return new Date(); }
    function formatNumber(num, decimals) { return Number(num).toFixed(decimals || 2); }
    function formatCurrency(amount) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0); }
    function addControlInfo(fc, controlName, message, uniqueId) {
        try {
            var c = ctrl(fc, controlName);
            if (c && typeof c.addNotification === "function") {
                c.addNotification({ messages: [message], notificationLevel: "INFO", uniqueId: uniqueId || (controlName + "_hint") });
            }
        } catch (e) { console.warn("addControlInfo:", controlName, e); }
    }
    function isVisibleAndEnabled(fc, name) {
        try { var c = ctrl(fc, name); return !!(c && c.getVisible() && !c.getDisabled()); } catch (_) { return false; }
    }

    PDG.Inventory = {

        // ========= Core Event Handlers =========
        onLoad: function (executionContext) {
            var formContext = executionContext.getFormContext();
            this.initializeForm(formContext);
            this.setupFieldDependencies(formContext);
            this.loadContextualData(formContext);
            this.setupLookupFiltering(formContext);
            this.performInitialValidations(formContext);
        },

        onSave: function (executionContext) {
            var formContext = executionContext.getFormContext();

            // Allow programmatic re-save to pass through
            if (this._bypassValidationSave) {
                this._bypassValidationSave = false;
                return true;
            }

            var args = executionContext.getEventArgs();
            var saveMode = typeof args.getSaveMode === 'function' ? args.getSaveMode() : null;
            try { if (formContext.data && formContext.data.entity && typeof formContext.data.entity.getIsDirty === 'function') {
                if (!formContext.data.entity.getIsDirty()) { return true; }
            }} catch(_){}

            // AUTOSAVE (70): do not block. Validate synchronously; if it fails, cancel.
            if (saveMode === 70) {
                if (!this.validateFormData(formContext)) {
                    args.preventDefault();
                    notify(formContext, "Please correct the validation errors before saving", "ERROR", "save_blocked", 5000);
                    return false;
                }
                // Fire async location check without blocking autosave
                this.validateLocationHierarchyAsync(formContext).then(function (ok) {
                    if (!ok) notify(formContext, "Selected bin does not belong to the selected warehouse", "ERROR", "location_hierarchy");
                });
                this.updateCalculatedFields(formContext);
                return true;
            }

            // EXPLICIT SAVE: block, validate async, then re-save
            this.clearAllNotifications(formContext);
            args.preventDefault();

            if (!this.validateFormData(formContext)) {
                notify(formContext, "Please correct the validation errors before saving", "ERROR", "save_blocked", 5000);
                return false;
            }

            this.validateLocationHierarchyAsync(formContext)
                .then(function (ok) {
                    if (!ok) {
                        notify(formContext, "Selected bin does not belong to the selected warehouse", "ERROR", "location_hierarchy");
                        return false;
                    }

                    this.updateCalculatedFields(formContext);
                    this._bypassValidationSave = true;
                    formContext.data.save(saveMode);
                    return true;
                }.bind(this))
                .catch(function (e) {
                    console.warn('Async save validation failed:', e);
                    notify(formContext, "Could not validate location. Please try again.", "ERROR", "save_blocked", 5000);
                    return false;
                });

            // We prevented the default; actual save will be triggered above
            return false;
        },

        // ========= Initialization =========
        initializeForm: function (formContext) {
            if (formContext.ui.getFormType() === 1) {
                this.setDefaults(formContext);
                this.showWelcomeMessage(formContext);
            }
            this.lockCalculatedFields(formContext);
        },

        setDefaults: function (formContext) {
            var defaults = {
                "pdg_onhandquantity": 0,
                "pdg_reservedquantity": 0,
                "pdg_onlinequantity": 0,
                "pdg_committedquantity": 0,
                "pdg_availableforcommit": 0,
                "pdg_damagedquantity": 0,
                "pdg_intransitquantity": 0,
                "pdg_quarantinequantity": 0,
                "pdg_minimumstock": 10,
                "pdg_maximumstock": 100,
                "pdg_reorderpoint": 20,
                "pdg_belowminimum": false,
                "pdg_marginpercentage": 0,
                "pdg_statusindicator": "Good Stock",
                "pdg_lastupdated": now()
            };

            Object.keys(defaults).forEach(function (field) {
                var attribute = attr(formContext, field);
                if (attribute && (attribute.getValue() === null || attribute.getValue() === undefined)) {
                    attribute.setValue(defaults[field]);
                }
            });

            //this.generateInventoryNumber(formContext);
        },

        lockCalculatedFields: function (formContext) {
            var calculatedFields = [
                "pdg_onlinequantity",
                "pdg_availableforcommit",
                "pdg_inventorynumber",
                "pdg_displayname",
                "pdg_locationpath",
                "pdg_statusindicator",
                "pdg_quickaction",
                "pdg_marginpercentage",
                "pdg_belowminimum",
                "pdg_totalvalue",
                "pdg_volume",
                "pdg_lastmovementdate",
                "pdg_lastcountdate",
                "pdg_averagecost",
                "pdg_fifo",
                "pdg_weightedaveragecost"
            ];

            calculatedFields.forEach(function (field) {
                var control = ctrl(formContext, field);
                if (control) control.setDisabled(true);
            });
        },

        // ========= Field Dependencies =========
        setupFieldDependencies: function (formContext) {
            var self = this;

            // Disable autofocus behavior (kept as a no-op for future toggling)
            this._focusNext = function () { };

            // Item selection changes
            var item = attr(formContext, "pdg_itemid");
            if (item) {
                item.addOnChange(function () {
                    self.onItemChanged(formContext);
                });
            }

            // Warehouse selection changes
            var warehouse = attr(formContext, "pdg_warehouseid");
            if (warehouse) {
                warehouse.addOnChange(function () {
                    self.onWarehouseChanged(formContext);
                });
            }

            // Bin lookup changes
            var bin = attr(formContext, "pdg_binid");
            if (bin) {
                bin.addOnChange(function () {
                    self.onBinChanged(formContext);
                    self.validateLocationHierarchy(formContext);
                    self.validateBinCapacity(formContext);
                });
            }

            // Quantity changes
            var quantities = ["pdg_onhandquantity", "pdg_reservedquantity", "pdg_committedquantity",
                "pdg_damagedquantity", "pdg_intransitquantity", "pdg_quarantinequantity"];
            quantities.forEach(function (field) {
                var attribute = attr(formContext, field);
                if (attribute) {
                    attribute.addOnChange(function () {
                        self.recalculateQuantities(formContext);
                        if (self.updateStockBar) self.updateStockBar(formContext);
                    });
                }
            });


            // Cost changes
            var costFields = ["pdg_costprice", "pdg_publicprice", "pdg_standardcost"];
            costFields.forEach(function (field) {
                var attribute = attr(formContext, field);
                if (attribute) {
                    attribute.addOnChange(function () {
                        self.recalculateCosts(formContext);
                        self.validateCostPriceRelationship(formContext);
                    });
                }
            });

            // Stock level changes
            var stockFields = ["pdg_minimumstock", "pdg_maximumstock", "pdg_reorderpoint"];
            stockFields.forEach(function (field) {
                var attribute = attr(formContext, field);
                if (attribute) {
                    attribute.addOnChange(function () {
                        self.validateStockLevels(formContext);
                    });
                }
            });

            // Dimension changes
            var dimensionFields = ["pdg_length", "pdg_width", "pdg_height"];
            dimensionFields.forEach(function (field) {
                var attribute = attr(formContext, field);
                if (attribute) {
                    attribute.addOnChange(function () {
                        self.calculateVolume(formContext);
                        self.validateBinCapacity(formContext);
                    });
                }
            });

            // Serial number validation
            var serialNumber = attr(formContext, "pdg_serialnumber");
            if (serialNumber) {
                serialNumber.addOnChange(function () {
                    self.validateSerialNumbers(formContext);
                });
            }

            // Barcode/SKU scan
            var barcodeField = attr(formContext, "pdg_barcodescan");
            if (barcodeField) {
                barcodeField.addOnChange(function () {
                    self.lookupItemByBarcode(formContext);
                    self.updateBarcodeImages(formContext);
                });
            }

            // Location barcode scan
            var locationBarcodeField = attr(formContext, "pdg_locationbarcode");
            if (locationBarcodeField) {
                locationBarcodeField.addOnChange(function () {
                    self.applyLocationBarcode(formContext);
                    self.updateBarcodeImages(formContext);
                });
            }

            // Date validation
            var dateFields = ["pdg_expirydate", "pdg_manufacturingdate", "pdg_receiptdate"];
            dateFields.forEach(function (field) {
                var attribute = attr(formContext, field);
                if (attribute) {
                    attribute.addOnChange(function () {
                        self.validateExpiryDateLogic(formContext);
                    });
                }
            });
        },

        // ========= Event Handlers =========
        onItemChanged: function (formContext) {
            clear(formContext, "item_details");
            clear(formContext, "uniq");

            this.loadItemSnapshot(formContext);
            this.checkUniqueness(formContext);
            //this.generateInventoryNumber(formContext);
            this.updateDisplayName(formContext);
            this.populateFromItem(formContext);
            this.validateSerialNumbers(formContext);
            this.validateCurrencyConsistency(formContext);
            if (typeof this._focusNext === 'function') { this._focusNext("pdg_itemid"); }
        },

        onWarehouseChanged: function (formContext) {
            clear(formContext, "warehouse_details");
            clear(formContext, "uniq");

            // Clear bin selection when warehouse changes
            var binAttr = attr(formContext, "pdg_binid");
            if (binAttr) {
                binAttr.setValue(null);
            }

            this.loadWarehouseSnapshot(formContext);
            this.checkUniqueness(formContext);
            //this.generateInventoryNumber(formContext);
            this.updateDisplayName(formContext);
            this.updateLocationPath(formContext);
            this.updateBinFiltering(formContext);
            this.updateBarcodeImages(formContext);
            this.updateLocationBarcodeFromBin(formContext);
        },

        onBinChanged: function (formContext) {
            this.updateLocationPath(formContext);
            this.updateDisplayName(formContext);
            //this.generateInventoryNumber(formContext);
            this.updateBarcodeImages(formContext);
            this.updateLocationBarcodeFromBin(formContext);
        },

        updateBinFiltering: function (formContext) {
            var binControl = ctrl(formContext, "pdg_binid");
            if (binControl) {
                binControl.setDisabled(true);
                setTimeout(function () {
                    binControl.setDisabled(false);
                }, 100);
            }
        },

        lookupItemByBarcode: function (formContext) {
            var scanAttr = attr(formContext, "pdg_barcodescan");
            var code = scanAttr && scanAttr.getValue();
            if (!code) return;

            var filter = "?$select=pdg_inventoryitemid,pdg_name" +
                "&$filter=(pdg_barcode eq '" + code + "'" +
                " or pdg_sku eq '" + code + "'" +
                " or pdg_qrcode eq '" + code + "'" +
                " or pdg_alternativesku eq '" + code + "')";

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventoryitem", filter)
                .then(function (res) {
                    if (res.entities.length > 0) {
                        var item = res.entities[0];
                        var lookup = [{ id: item.pdg_inventoryitemid, name: item.pdg_name, entityType: "pdg_inventoryitem" }];
                        setIf(formContext, "pdg_itemid", lookup);
                        scanAttr.setValue(null);
                        clear(formContext, "barcode_not_found");
                    } else {
                        notify(formContext, "No item found for scanned code", "WARNING", "barcode_not_found", 5000);
                    }
                })
                .catch(function (e) {
                    console.warn("lookupItemByBarcode:", e);
                });
        },

        // ========= Display Name Generation =========
        updateDisplayName: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();
            var availableQty = attr(formContext, "pdg_onlinequantity") && attr(formContext, "pdg_onlinequantity").getValue();

            if (!item || !warehouse) {
                setIf(formContext, "pdg_displayname", "");
                return;
            }

            var itemName = getLookupName(item);
            var warehouseName = getLookupName(warehouse);
            var binName = bin ? getLookupName(bin) : "";
            var location = warehouseName + (binName ? "-" + binName : "");
            // Intentionally omit quantity from display name to avoid confusion as quantities change
            // If needed later, we can re-append ` - ${qtyDisplay}` where qtyDisplay mirrors prior logic
            var qtyDisplay = availableQty !== null ? availableQty + " Available" : "0 Available";

            // Get SKU/item code from cached details if available
            var itemDetails = formContext._itemDetails;
            var sku = itemDetails && itemDetails.sku ? itemDetails.sku : "";

            // Format updated to keep name stable as quantities change:
            // "HP Laptop 15\" Silver - Warehouse A-B3 - HPL-15-SLV"
            var displayName = itemName + " - " + location;
            if (sku) {
                displayName += " - " + sku;
            }

            setIf(formContext, "pdg_displayname", displayName);
        },

        // ========= Location Path Generation =========
        updateLocationPath: function (formContext) {
            var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();
            if (!bin) {
                setIf(formContext, "pdg_locationpath", "");
                return;
            }

            var binId = getLookupId(bin);
            Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=pdg_locationpath")
                .then(function (res) {
                    setIf(formContext, "pdg_locationpath", res.pdg_locationpath || "");
                })
                .catch(function (e) {
                    console.warn("updateLocationPath:", e);
                    setIf(formContext, "pdg_locationpath", "");
                });
        },

        // ========= Status Indicator Updates =========
        updateStatusIndicator: function (formContext) {
            var onhand = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
            var online = num(attr(formContext, "pdg_onlinequantity") && attr(formContext, "pdg_onlinequantity").getValue());
            var minimum = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
            var reorderPoint = num(attr(formContext, "pdg_reorderpoint") && attr(formContext, "pdg_reorderpoint").getValue());
            var quarantine = num(attr(formContext, "pdg_quarantinequantity") && attr(formContext, "pdg_quarantinequantity").getValue());
            var damaged = num(attr(formContext, "pdg_damagedquantity") && attr(formContext, "pdg_damagedquantity").getValue());

            var status = "Good Stock";
            var level = "INFO";
            var badge = "??"; // default Adequate

            // Determine status based on multiple factors
            if (online <= 0) {
                status = "Out of Stock";
                level = "WARNING";
                badge = "??";
            } else if (reorderPoint > 0 && online <= reorderPoint) {
                status = "Low Stock";
                level = "WARNING";
                badge = "??";
            } else if (minimum > 0 && online < minimum) {
                status = "Low Stock";
                level = "WARNING";
                badge = "??";
            } else if (minimum > 0 && online < minimum * 1.5) {
                status = "Monitor Stock";
                level = "INFO";
            }

            // Add indicators for quality issues
            if (quarantine > 0) {
                status += " (Quarantine: " + quarantine + ")";
                badge = "??";
            }
            if (damaged > 0) {
                status += " (Damaged: " + damaged + ")";
                badge = "??";
            }

            setIf(formContext, "pdg_statusindicator", status);
            try { var c = ctrl(formContext, "pdg_statusindicator"); if (c && c.setLabel) { c.setLabel("Stock Status " + badge); } } catch(_){}
            notify(formContext, "Stock Status: " + status, level, "stock_status");
        },

        // ========= Quick Actions Generation =========
        updateQuickActions: function (formContext) {
            var actions = [];
            var onhand = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
            var online = num(attr(formContext, "pdg_onlinequantity") && attr(formContext, "pdg_onlinequantity").getValue());
            var minimum = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
            var reorderPoint = num(attr(formContext, "pdg_reorderpoint") && attr(formContext, "pdg_reorderpoint").getValue());
            var damaged = num(attr(formContext, "pdg_damagedquantity") && attr(formContext, "pdg_damagedquantity").getValue());
            var quarantine = num(attr(formContext, "pdg_quarantinequantity") && attr(formContext, "pdg_quarantinequantity").getValue());

            // Stock level actions
            if (online <= 0) {
                actions.push("?? URGENT: Replenish Stock");
            } else if (reorderPoint > 0 && online <= reorderPoint) {
                actions.push("?? Reorder Needed");
            } else if (minimum > 0 && online < minimum) {
                actions.push("?? Below Minimum - Consider Reorder");
            }

            // Quality actions
            if (damaged > 0) {
                actions.push("?? Process Damaged Items (" + damaged + ")");
            }
            if (quarantine > 0) {
                actions.push("?? Review Quarantined Items (" + quarantine + ")");
            }

            // Cycle count actions
            var lastCount = attr(formContext, "pdg_lastcountdate") && attr(formContext, "pdg_lastcountdate").getValue();
            if (!lastCount || (new Date() - new Date(lastCount)) > 30 * 24 * 60 * 60 * 1000) { // 30 days
                actions.push("?? Cycle Count Due");
            }

            // Cost review actions
            var marginPercent = num(attr(formContext, "pdg_marginpercentage") && attr(formContext, "pdg_marginpercentage").getValue());
            if (marginPercent < 15) {
                actions.push("?? Review Pricing/Costs");
            }

            var actionText = actions.length > 0 ? actions.join("\n") : "No actions required";
            setIf(formContext, "pdg_quickaction", actionText);
        },

        // ========= Inventory Number Generation =========
        generateInventoryNumber: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();

            if (!item || !warehouse) return;

            var itemId = getLookupId(item);
            var warehouseId = getLookupId(warehouse);

            Promise.all([
                Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId, "?$select=pdg_sku,pdg_qrcode,pdg_name,pdg_alternativesku"),
                Xrm.WebApi.retrieveRecord("pdg_warehouse", warehouseId, "?$select=pdg_longname,pdg_erpcode,pdg_externalwarehouseid,pdg_costcode")
            ]).then(function (results) {
                var itemData = results[0];
                var warehouseData = results[1];

                var itemCode = itemData.pdg_qrcode || itemData.pdg_sku || itemData.pdg_alternativesku || "ITEM";
                var warehouseCode = warehouseData.pdg_erpcode ||
                    warehouseData.pdg_externalwarehouseid ||
                    warehouseData.pdg_costcode ||
                    (warehouseData.pdg_longname && warehouseData.pdg_longname.substring(0, 3)) ||
                    "WH";

                // Get bin code from lookup if available
                var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();
                var binCode = bin ? getLookupName(bin) : "A01";
                var sequence = this.generateSequenceNumber();

                var inventoryNumber = itemCode.toUpperCase() + "-" +
                    warehouseCode.toUpperCase() + "-" +
                    binCode.toUpperCase() + "-" +
                    sequence;

                setIf(formContext, "pdg_inventorynumber", inventoryNumber);
            }.bind(this))
                .catch(function (error) {
                    var itemName = getLookupName(item) || "ITEM";
                    var warehouseName = getLookupName(warehouse) || "WH";
                    var timestamp = Date.now().toString().slice(-4);

                    var inventoryNumber = itemName.substring(0, 4).toUpperCase() + "-" +
                        warehouseName.substring(0, 3).toUpperCase() + "-" +
                        timestamp;

                    setIf(formContext, "pdg_inventorynumber", inventoryNumber);
                    console.warn("Inventory number generation failed, using fallback:", error);
                });
        },

        generateSequenceNumber: function () {
            return String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
        },

        // ========= Data Loading =========
        loadItemSnapshot: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var id = getLookupId(item);
            if (!id) return;

            var selectFields = "?$select=pdg_name,pdg_sku,pdg_qrcode,pdg_unitcost,pdg_publicprice,pdg_measurementunit," +
                "pdg_description,pdg_height,pdg_width,pdg_length,pdg_alternativesku," +
                "pdg_supplieritemcode,pdg_barcode,pdg_standardcost,pdg_grossweight,pdg_netweight," +
                "pdg_metalweight,pdg_stoneweight,pdg_reorderlevel,pdg_safetystock,pdg_economicorderqty," +
                "pdg_fastmoving,pdg_hazardousmaterial,pdg_serialcontrolled,pdg_expirytracking,transactioncurrencyid";

            Xrm.WebApi.retrieveRecord("pdg_inventoryitem", id, selectFields)
                .then(function (rec) {
                    formContext._itemDetails = {
                        name: rec.pdg_name,
                        sku: rec.pdg_sku || rec.pdg_qrcode || rec.pdg_alternativesku,
                        itemCode: rec.pdg_qrcode,
                        cost: rec.pdg_unitcost,
                        standardCost: rec.pdg_standardcost,
                        price: rec.pdg_publicprice,
                        category: rec.pdg_category,
                        description: rec.pdg_description,
                        supplierCode: rec.pdg_supplieritemcode,
                        barcode: rec.pdg_barcode,
                        grossWeight: rec.pdg_grossweight,
                        netWeight: rec.pdg_netweight,
                        metalWeight: rec.pdg_metalweight,
                        stoneWeight: rec.pdg_stoneweight,
                        currency: rec.transactioncurrencyid,
                        dimensions: {
                            length: rec.pdg_length,
                            width: rec.pdg_width,
                            height: rec.pdg_height
                        },
                        stockSettings: {
                            reorderLevel: rec.pdg_reorderlevel,
                            safetyStock: rec.pdg_safetystock,
                            economicOrderQty: rec.pdg_economicorderqty,
                            isFastMoving: rec.pdg_fastmoving
                        },
                        properties: {
                            isHazardous: rec.pdg_hazardousmaterial,
                            isSerialControlled: rec.pdg_serialcontrolled,
                            hasExpiryTracking: rec.pdg_expirytracking
                        }
                    };

                    // Auto-populate fields from item master
                    this.autoPopulateFromItem(formContext, rec);

                    // Show item details notification
                    var msg = "Item: " + (rec.pdg_name || "");
                    if (rec.pdg_qrcode) msg += " | Code: " + rec.pdg_qrcode;
                    if (rec.pdg_sku) msg += " | SKU: " + rec.pdg_sku;
                    if (rec.pdg_category) msg += " | Category: " + rec.pdg_category;
                    if (rec.pdg_unitcost || rec.pdg_publicprice) {
                        msg += " | Cost: " + formatCurrency(rec.pdg_unitcost || 0) +
                            " | Price: " + formatCurrency(rec.pdg_publicprice || 0);
                    }

                    notify(formContext, msg, "INFO", "item_details", 8000);

                }.bind(this))
                .catch(function (e) {
                    notify(formContext, "Could not load item details: " + e.message, "WARNING", "item_error", 5000);
                    console.warn("loadItemSnapshot error:", e);
                });
        },

        autoPopulateFromItem: function (formContext, itemData) {
            // Auto-populate cost fields (guard when fields are not on this form)
            var aCost = attr(formContext, "pdg_costprice");
            if (itemData.pdg_unitcost && aCost && !aCost.getValue()) setIf(formContext, "pdg_costprice", itemData.pdg_unitcost);
            var aPrice = attr(formContext, "pdg_publicprice");
            if (itemData.pdg_publicprice && aPrice && !aPrice.getValue()) setIf(formContext, "pdg_publicprice", itemData.pdg_publicprice);
            var aStd = attr(formContext, "pdg_standardcost");
            if (itemData.pdg_standardcost && aStd && !aStd.getValue()) setIf(formContext, "pdg_standardcost", itemData.pdg_standardcost);

            // Auto-populate physical dimensions
            var aLen = attr(formContext, "pdg_length"); if (itemData.pdg_length && aLen && !aLen.getValue()) setIf(formContext, "pdg_length", itemData.pdg_length);
            var aWid = attr(formContext, "pdg_width"); if (itemData.pdg_width && aWid && !aWid.getValue()) setIf(formContext, "pdg_width", itemData.pdg_width);
            var aHei = attr(formContext, "pdg_height"); if (itemData.pdg_height && aHei && !aHei.getValue()) setIf(formContext, "pdg_height", itemData.pdg_height);

            // Auto-populate weights (jewelry-specific)
            var aGw = attr(formContext, "pdg_grossweight"); if (itemData.pdg_grossweight && aGw && !aGw.getValue()) setIf(formContext, "pdg_grossweight", itemData.pdg_grossweight);
            var aNw = attr(formContext, "pdg_netweight"); if (itemData.pdg_netweight && aNw && !aNw.getValue()) setIf(formContext, "pdg_netweight", itemData.pdg_netweight);
            var aMw = attr(formContext, "pdg_metalweight"); if (itemData.pdg_metalweight && aMw && !aMw.getValue()) setIf(formContext, "pdg_metalweight", itemData.pdg_metalweight);
            var aSw = attr(formContext, "pdg_stoneweight"); if (itemData.pdg_stoneweight && aSw && !aSw.getValue()) setIf(formContext, "pdg_stoneweight", itemData.pdg_stoneweight);

            // Auto-populate stock levels
            var aReo = attr(formContext, "pdg_reorderpoint"); if (itemData.pdg_reorderlevel && aReo && !aReo.getValue()) setIf(formContext, "pdg_reorderpoint", itemData.pdg_reorderlevel);
            var aMin = attr(formContext, "pdg_minimumstock"); if (itemData.pdg_safetystock && aMin && !aMin.getValue()) setIf(formContext, "pdg_minimumstock", itemData.pdg_safetystock);

            // Suggest initial scan value from item identifiers if empty
            var scanAttr = attr(formContext, "pdg_barcodescan");
            if (scanAttr && (scanAttr.getValue() === null || scanAttr.getValue() === undefined || scanAttr.getValue() === "")) {
                var initCode = itemData.pdg_barcode || itemData.pdg_sku || itemData.pdg_qrcode || null;
                if (initCode) { scanAttr.setValue(initCode); this.updateBarcodeImages(formContext); }
            }

            // Set condition status for hazardous materials
            var aCond = attr(formContext, "pdg_conditionstatus"); if (itemData.pdg_hazardousmaterial && aCond && !aCond.getValue()) setIf(formContext, "pdg_conditionstatus", 762170002);
        },

        loadWarehouseSnapshot: function (formContext) {
            var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            var id = getLookupId(warehouse);
            if (!id) return;

            Xrm.WebApi.retrieveRecord("pdg_warehouse", id,
                "?$select=pdg_longname,pdg_erpcode,pdg_location,pdg_capacity,pdg_operatinghours,pdg_contactnumber"
            ).then(function (rec) {
                var msg = "Warehouse: " + (rec.pdg_longname || "");

                var code = rec.pdg_erpcode || rec.pdg_externalwarehouseid || rec.pdg_costcode;
                if (code) msg += " | Code: " + code;

                if (rec.pdg_location) msg += " | Location: " + rec.pdg_location;
                // Manager name column may not exist in your model; omit to avoid 400s

                notify(formContext, msg, "INFO", "warehouse_details", 6000);
            }).catch(function (e) {
                console.warn("loadWarehouseSnapshot error:", e);
            });
        },

        // ========= Calculations =========
        recalculateQuantities: function (formContext) {
            var onhand = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
            var reserved = num(attr(formContext, "pdg_reservedquantity") && attr(formContext, "pdg_reservedquantity").getValue());
            var committed = num(attr(formContext, "pdg_committedquantity") && attr(formContext, "pdg_committedquantity").getValue());
            var damaged = num(attr(formContext, "pdg_damagedquantity") && attr(formContext, "pdg_damagedquantity").getValue());
            var quarantine = num(attr(formContext, "pdg_quarantinequantity") && attr(formContext, "pdg_quarantinequantity").getValue());
            var intransit = num(attr(formContext, "pdg_intransitquantity") && attr(formContext, "pdg_intransitquantity").getValue());

            var online = Math.max(onhand - reserved - damaged - quarantine, 0);
            var availableForCommit = Math.max(online - committed, 0);

            setIf(formContext, "pdg_onlinequantity", online);
            setIf(formContext, "pdg_availableforcommit", availableForCommit);

            // Update below minimum indicator
            var minimum = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
            var belowMin = minimum > 0 && online < minimum;
            setIf(formContext, "pdg_belowminimum", belowMin);

            this.updateStatusIndicator(formContext);
            this.updateDisplayName(formContext);
            this.updateQuickActions(formContext);
            this.recalculateCosts(formContext);
        },

        recalculateCosts: function (formContext) {
            var cost = num(attr(formContext, "pdg_costprice") && attr(formContext, "pdg_costprice").getValue());
            var price = num(attr(formContext, "pdg_publicprice") && attr(formContext, "pdg_publicprice").getValue());
            var qty = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());

            var totalValue = cost * qty;
            setIf(formContext, "pdg_totalvalue", totalValue);

            if (price > 0 && cost > 0) {
                var marginPercent = ((price - cost) / price) * 100;
                setIf(formContext, "pdg_marginpercentage", marginPercent);
                this.showCostingInsights(formContext, marginPercent, totalValue);
            } else {
                setIf(formContext, "pdg_marginpercentage", 0);
                clear(formContext, "cost_insights");
            }

            this.updateQuickActions(formContext);
            this.validateHighValueItemSecurity(formContext);
        },

        calculateVolume: function (formContext) {
            var length = num(attr(formContext, "pdg_length") && attr(formContext, "pdg_length").getValue());
            var width = num(attr(formContext, "pdg_width") && attr(formContext, "pdg_width").getValue());
            var height = num(attr(formContext, "pdg_height") && attr(formContext, "pdg_height").getValue());

            if (length > 0 && width > 0 && height > 0) {
                var volume = length * width * height;
                setIf(formContext, "pdg_volume", volume);

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

                notify(formContext, "Volume calculated: " + displayVolume + " " + unit, "INFO", "volume_calc", 3000);
            } else {
                setIf(formContext, "pdg_volume", 0);
            }
        },

        showCostingInsights: function (formContext, marginPercent, totalValue) {
            var msg = "Financial: Total Value: " + formatCurrency(totalValue) +
                " | Margin: " + formatNumber(marginPercent, 1) + "%";

            var type = "INFO";
            if (marginPercent < 15) {
                msg += " (Below Target)";
                type = "WARNING";
            } else if (marginPercent > 40) {
                msg += " (Excellent)";
            } else if (marginPercent > 25) {
                msg += " (Good)";
            }

            notify(formContext, msg, type, "cost_insights", 6000);
        },

        // ========= Enhanced Lookup Filtering =========
        setupLookupFiltering: function (formContext) {
            // Filter items to only show active ones
            var itemControl = ctrl(formContext, "pdg_itemid");
            if (itemControl) {
                itemControl.addPreSearch(function () {
                    var filter = "<filter type='and'>" +
                        "   <condition attribute='statecode' operator='eq' value='0' />" +
                        "</filter>";
                    itemControl.addCustomFilter(filter);
                });
            }

            // Filter bins by selected warehouse
            var binControl = ctrl(formContext, "pdg_binid");
            if (binControl) {
                binControl.addPreSearch(function () {
                    var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
                    if (warehouse) {
                        var warehouseId = getLookupId(warehouse);
                        var filter = "<filter type='and'>" +
                            "   <condition attribute='statecode' operator='eq' value='0' />" +
                            "   <condition attribute='pdg_warehouseid' operator='eq' value='" + warehouseId + "' />" +
                            "</filter>";
                        binControl.addCustomFilter(filter);
                    } else {
                        // No warehouse selected, show no bins
                        var filter = "<filter type='and'>" +
                            "   <condition attribute='pdg_binid' operator='eq' value='{00000000-0000-0000-0000-000000000000}' />" +
                            "</filter>";
                        binControl.addCustomFilter(filter);
                    }
                });
            }
        },

        // ========= Validation =========
        validateFormData: function (formContext) {
            var isValid = true;
            clear(formContext, "validation_errors");

            // Existing validations
            if (!this.validateRequiredFields(formContext)) isValid = false;
            if (!this.validateBusinessRules(formContext)) isValid = false;
            if (!this.validateDataIntegrity(formContext)) isValid = false;

            // Enhanced validations
            if (!this.validateSerialNumbers(formContext)) isValid = false;
            if (!this.validateCostPriceRelationship(formContext)) isValid = false;
            if (!this.validateExpiryDateLogic(formContext)) isValid = false;
            if (!this.validateCurrencyConsistency(formContext)) isValid = false;
            if (!this.validateLocationHierarchy(formContext)) isValid = false;

            // Non-blocking validations (warnings only)
            this.validateBinCapacity(formContext);
            this.validateHighValueItemSecurity(formContext);

            return isValid;
        },

        validateRequiredFields: function (formContext) {
            var requiredFields = [
                { field: "pdg_itemid", name: "Item" },
                { field: "pdg_warehouseid", name: "Warehouse" }
            ];

            var missingFields = [];
            requiredFields.forEach(function (req) {
                var attr_val = attr(formContext, req.field);
                if (!attr_val || !attr_val.getValue()) {
                    missingFields.push(req.name);
                }
            });

            if (missingFields.length > 0) {
                notify(formContext, "Required fields missing: " + missingFields.join(", "), "ERROR", "required_fields");
                return false;
            }
            return true;
        },

        validateBusinessRules: function (formContext) {
            return this.validateStockLevels(formContext);
        },

        validateStockLevels: function (formContext) {
            var minimum = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
            var maximum = num(attr(formContext, "pdg_maximumstock") && attr(formContext, "pdg_maximumstock").getValue());
            var reorder = num(attr(formContext, "pdg_reorderpoint") && attr(formContext, "pdg_reorderpoint").getValue());

            clear(formContext, "stock_validation");

            if (minimum < 0 || maximum < 0 || reorder < 0) {
                notify(formContext, "Stock levels cannot be negative", "ERROR", "stock_validation");
                return false;
            }

            if (maximum > 0 && minimum > 0 && maximum < minimum) {
                notify(formContext, "Maximum stock must be greater than minimum stock", "ERROR", "stock_validation");
                return false;
            }

            if (reorder > 0 && minimum > 0 && reorder < minimum) {
                notify(formContext, "Reorder point is below minimum stock level", "WARNING", "stock_validation", 5000);
            }

            return true;
        },

        validateDataIntegrity: function (formContext) {
            var onhand = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
            var reserved = num(attr(formContext, "pdg_reservedquantity") && attr(formContext, "pdg_reservedquantity").getValue());
            var committed = num(attr(formContext, "pdg_committedquantity") && attr(formContext, "pdg_committedquantity").getValue());
            var damaged = num(attr(formContext, "pdg_damagedquantity") && attr(formContext, "pdg_damagedquantity").getValue());
            var quarantine = num(attr(formContext, "pdg_quarantinequantity") && attr(formContext, "pdg_quarantinequantity").getValue());

            var totalAllocated = reserved + committed + damaged + quarantine;

            if (totalAllocated > onhand) {
                notify(formContext, "Total allocated quantities (" + totalAllocated + ") exceed on-hand quantity (" + onhand + ")",
                    "ERROR", "quantity_validation");
                return false;
            }

            return true;
        },

        // ========= Enhanced Validations =========
        // Render stock level progress bar web resource
        updateStockBar: function (formContext) {
            try {
                var onhand = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
                var available = num(attr(formContext, "pdg_onlinequantity") && attr(formContext, "pdg_onlinequantity").getValue());
                var reserved = num(attr(formContext, "pdg_reservedquantity") && attr(formContext, "pdg_reservedquantity").getValue());
                var maximum = num(attr(formContext, "pdg_maximumstock") && attr(formContext, "pdg_maximumstock").getValue());
                var minimum = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
                var reorder = num(attr(formContext, "pdg_reorderpoint") && attr(formContext, "pdg_reorderpoint").getValue());

                if (!maximum && minimum) maximum = minimum * 2;
                var payload = { onhand: onhand, available: available, reserved: reserved, max: maximum, min: minimum, reorder: reorder };

                var wr = ctrl(formContext, "WebResource_StockBar");
                if (!wr || typeof wr.setSrc !== 'function') return;
                var src = (typeof wr.getSrc === 'function') ? wr.getSrc() : null;
                var base = src ? src.split('?')[0] : "/WebResources/pdg_stockbar";
                wr.setSrc(base + "?data=" + encodeURIComponent(JSON.stringify(payload)) + "&v=" + Date.now());
            } catch (e) {
                console.warn("updateStockBar:", e);
            }
        },
        // Align with Bin design: pdg_capacity represents maximum units (count), not physical volume
        validateBinCapacity: function (formContext) {
            var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();
            var onhandQty = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());

            if (!bin || onhandQty < 0) return true;

            var binId = getLookupId(bin);

            Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=pdg_capacity,pdg_weightcapacity")
                .then(function (binData) {
                    var maxUnits = num(binData.pdg_capacity);

                    if (maxUnits > 0 && onhandQty > maxUnits) {
                        notify(formContext,
                            "Warning: Quantity (" + onhandQty + ") exceeds bin capacity (" + maxUnits + ")",
                            "WARNING", "bin_capacity", 10000);
                    }

                    // Check current bin utilization by units
                    this.checkCurrentBinUtilization(formContext, binId, onhandQty);
                }.bind(this))
                .catch(function (e) {
                    console.warn("Bin capacity validation failed:", e);
                });

            return true;
        },

        checkCurrentBinUtilization: function (formContext, binId, newQty) {
            var currentId = formContext.data.entity.getId();
            var filter = "?$select=pdg_onhandquantity&$filter=_pdg_binid_value eq " + binId +
                " and statecode eq 0" +
                (currentId ? " and pdg_inventoryid ne " + currentId.replace(/[{}]/g, "") : "");

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", filter)
                .then(function (results) {
                    var totalQty = num(newQty);
                    results.entities.forEach(function (inv) {
                        totalQty += num(inv.pdg_onhandquantity);
                    });

                    Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=pdg_capacity")
                        .then(function (binData) {
                            var maxUnits = num(binData.pdg_capacity);
                            if (maxUnits > 0 && totalQty > maxUnits) {
                                var utilizationPercent = ((totalQty / maxUnits) * 100).toFixed(1);
                                notify(formContext,
                                    "Bin Utilization Alert: " + utilizationPercent + "% capacity used (" +
                                    totalQty + "/" + maxUnits + " units)",
                                    utilizationPercent > 95 ? "ERROR" : "WARNING", "bin_utilization", 10000);
                            }
                        });
                })
                .catch(function (e) {
                    console.warn("Bin utilization check failed:", e);
                });
        },

        validateSerialNumbers: function (formContext) {
            var itemId = getLookupId(attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue());
            var serialNumber = attr(formContext, "pdg_serialnumber") && attr(formContext, "pdg_serialnumber").getValue();
            // Lot number is a lookup (pdg_lotnumberid)
            var lotLookupVal = attr(formContext, "pdg_lotnumberid") && attr(formContext, "pdg_lotnumberid").getValue();
            var lotId = getLookupId(lotLookupVal);

            if (!itemId) return true;

            // Check if item requires serial control
            Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId, "?$select=pdg_serialcontrolled,pdg_expirytracking")
                .then(function (itemData) {
                    var requiresSerial = itemData.pdg_serialcontrolled;
                    var requiresExpiry = itemData.pdg_expirytracking;

                    if (requiresSerial && !serialNumber && !lotId) {
                        notify(formContext, "Serial or lot number required for this item", "ERROR", "serial_required");
                        return false;
                    }

                    if (requiresExpiry) {
                        var expiryDate = attr(formContext, "pdg_expirydate") && attr(formContext, "pdg_expirydate").getValue();
                        if (!expiryDate) {
                            notify(formContext, "Expiry date required for this item", "ERROR", "expiry_required");
                            return false;
                        }

                        // Check if expiry date is in the past
                        if (expiryDate < new Date()) {
                            notify(formContext, "Warning: Item has already expired", "WARNING", "expired_item", 8000);
                        }
                    }

                    // Check serial and lot uniqueness
                    if (serialNumber) {
                        this.checkSerialUniqueness(formContext, itemId, serialNumber);
                    }
                    if (lotId) { this.checkLotUniqueness(formContext, itemId, lotId); }
                }.bind(this))
                .catch(function (e) {
                    console.warn("Serial number validation failed:", e);
                });

            return true;
        },

        checkSerialUniqueness: function (formContext, itemId, serialNumber) {
            var currentId = formContext.data.entity.getId();
            var filter = "?$select=pdg_inventoryid,pdg_serialnumber&$filter=" +
                "_pdg_itemid_value eq " + itemId +
                " and pdg_serialnumber eq '" + serialNumber + "'" +
                " and statecode eq 0" +
                (currentId ? " and pdg_inventoryid ne " + currentId.replace(/[{}]/g, "") : "");

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", filter)
                .then(function (results) {
                    if (results.entities.length > 0) {
                        notify(formContext,
                            "Serial number '" + serialNumber + "' already exists for this item",
                            "ERROR", "serial_duplicate");
                    } else {
                        clear(formContext, "serial_duplicate");
                    }
                })
                .catch(function (e) {
                    console.warn("Serial uniqueness check failed:", e);
                });
        },

        // Removed legacy checkBatchUniqueness – lot lookup is used instead

        checkLotUniqueness: function (formContext, itemId, lotId) {
            var currentId = formContext.data.entity.getId();
            var filter = "?$select=pdg_inventoryid&$filter=" +
                "_pdg_itemid_value eq " + itemId +
                " and _pdg_lotnumberid_value eq " + lotId +
                " and statecode eq 0" +
                (currentId ? " and pdg_inventoryid ne " + currentId.replace(/[{}]/g, "") : "");

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", filter)
                .then(function (results) {
                    if (results.entities.length > 0) {
                        notify(formContext,
                            "Lot already exists for this item", "ERROR", "lot_duplicate");
                    } else {
                        clear(formContext, "lot_duplicate");
                    }
                })
                .catch(function (e) { console.warn("Lot uniqueness check failed:", e); });
        },

        validateCostPriceRelationship: function (formContext) {
            var cost = num(attr(formContext, "pdg_costprice") && attr(formContext, "pdg_costprice").getValue());
            var price = num(attr(formContext, "pdg_publicprice") && attr(formContext, "pdg_publicprice").getValue());
            var standardCost = num(attr(formContext, "pdg_standardcost") && attr(formContext, "pdg_standardcost").getValue());

            clear(formContext, "cost_validation");

            // Validate cost vs price relationship
            if (cost > 0 && price > 0 && cost > price) {
                notify(formContext,
                    "Alert: Cost price (" + formatCurrency(cost) + ") is higher than public price (" + formatCurrency(price) + ")",
                    "WARNING", "cost_validation", 8000);
            }

            // Validate significant variance from standard cost
            if (cost > 0 && standardCost > 0) {
                var variance = Math.abs(cost - standardCost) / standardCost * 100;
                if (variance > 20) { // More than 20% variance
                    notify(formContext,
                        "Cost Variance Alert: " + variance.toFixed(1) + "% difference from standard cost (" + formatCurrency(standardCost) + ")",
                        variance > 50 ? "WARNING" : "INFO", "cost_variance", 6000);
                }
            }

            return true;
        },

        validateHighValueItemSecurity: function (formContext) {
            var totalValue = num(attr(formContext, "pdg_totalvalue") && attr(formContext, "pdg_totalvalue").getValue());
            var HIGH_VALUE_THRESHOLD = 10000; // Configurable threshold

            if (totalValue > HIGH_VALUE_THRESHOLD) {
                // Check user permissions for high-value items
                var currentUserId = Xrm.Utility.getGlobalContext().userSettings.userId.replace(/[{}]/g, "");

                // This would typically check against a security role or custom permission
                notify(formContext,
                    "High Value Item: Total value " + formatCurrency(totalValue) + " requires additional approvals",
                    "INFO", "high_value", 10000);
            }

            return true;
        },

        validateExpiryDateLogic: function (formContext) {
            var expiryDate = attr(formContext, "pdg_expirydate") && attr(formContext, "pdg_expirydate").getValue();
            var manufacturingDate = attr(formContext, "pdg_manufacturingdate") && attr(formContext, "pdg_manufacturingdate").getValue();
            var receiptDate = attr(formContext, "pdg_receiptdate") && attr(formContext, "pdg_receiptdate").getValue();

            clear(formContext, "date_validation");

            if (expiryDate && manufacturingDate && expiryDate <= manufacturingDate) {
                notify(formContext, "Expiry date must be after manufacturing date", "ERROR", "date_validation");
                return false;
            }

            if (expiryDate && receiptDate && expiryDate <= receiptDate) {
                notify(formContext, "Expiry date must be after receipt date", "ERROR", "date_validation");
                return false;
            }

            // Warn about items expiring soon (30 days)
            if (expiryDate) {
                var daysUntilExpiry = (expiryDate - new Date()) / (1000 * 60 * 60 * 24);
                if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
                    notify(formContext,
                        "Expiry Warning: Item expires in " + Math.floor(daysUntilExpiry) + " days",
                        "WARNING", "expiry_warning", 8000);
                }
            }

            return true;
        },

        validateCurrencyConsistency: function (formContext) {
            var transactionCurrency = attr(formContext, "transactioncurrencyid") && attr(formContext, "transactioncurrencyid").getValue();
            var itemId = getLookupId(attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue());

            if (!itemId || !transactionCurrency) return true;

            // Check if item has a preferred currency
            Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId, "?$select=transactioncurrencyid")
                .then(function (itemData) {
                    if (itemData.transactioncurrencyid) {
                        var itemCurrencyId = itemData.transactioncurrencyid.replace(/[{}]/g, "");
                        var inventoryCurrencyId = getLookupId(transactionCurrency);

                        if (itemCurrencyId !== inventoryCurrencyId) {
                            notify(formContext,
                                "Currency mismatch: Inventory currency differs from item's default currency",
                                "WARNING", "currency_mismatch", 6000);
                        }
                    }
                })
                .catch(function (e) {
                    console.warn("Currency validation failed:", e);
                });

            return true;
        },

        validateLocationHierarchy: function (formContext) {
            var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();

            if (!warehouse) return true;

            var warehouseId = getLookupId(warehouse);

            // Validate bin belongs to warehouse
            if (bin) {
                var binId = getLookupId(bin);
                Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=_pdg_warehouseid_value")
                    .then(function (binData) {
                        var binWh = (binData._pdg_warehouseid_value || "").toString().toLowerCase();
                        var whId = (warehouseId || "").toString().toLowerCase();
                        if (binWh !== whId) {
                            notify(formContext, "Selected bin does not belong to the selected warehouse", "ERROR", "location_hierarchy");
                            return false;
                        } else {
                            // Clear any prior error if the selection is valid
                            clear(formContext, "location_hierarchy");
                        }
                    })
                    .catch(function (e) {
                        console.warn("Location hierarchy validation failed:", e);
                    });
            }

            return true;
        },

        // Async version used to block save until the relationship is verified
        validateLocationHierarchyAsync: function (formContext) {
            var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();

            if (!warehouse || !bin) return Promise.resolve(true);

            var warehouseId = getLookupId(warehouse);
            var binId = getLookupId(bin);

            return Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=_pdg_warehouseid_value").then(function (binData) {
                var binWh = (binData._pdg_warehouseid_value || "").toString().toLowerCase();
                var whId = (warehouseId || "").toString().toLowerCase();
                return binWh === whId;
            }).catch(function (e) {
                console.warn("validateLocationHierarchyAsync:", e);
                return false;
            });
        },

        // ========= Utility Functions =========
        checkUniqueness: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var warehouse = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();

            if (!item || !warehouse) {
                clear(formContext, "uniq");
                return;
            }

            var itemId = getLookupId(item);
            var warehouseId = getLookupId(warehouse);
            var currentId = formContext.data.entity.getId();

            var query = "?$select=pdg_inventoryid,pdg_inventorynumber,pdg_displayname&$filter=" +
                "_pdg_itemid_value eq " + itemId +
                " and _pdg_warehouseid_value eq " + warehouseId +
                (currentId ? " and pdg_inventoryid ne " + currentId.replace(/[{}]/g, "") : "");

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", query)
                .then(function (res) {
                    if (res.entities.length > 0) {
                        var existing = res.entities[0];
                        var displayText = existing.pdg_displayname || existing.pdg_inventorynumber || existing.pdg_inventoryid;
                        notify(formContext, "Inventory already exists: " + displayText, "WARNING", "uniq");
                    } else {
                        clear(formContext, "uniq");
                    }
                }).catch(function (e) {
                    console.warn("uniqueness check failed:", e);
                });
        },

        // ========= Context Data Loading =========
        loadContextualData: function (formContext) {
            this.loadRecentTransactions(formContext);
            this.loadRelatedInventory(formContext);
        },

        loadRecentTransactions: function (formContext) {
            var invId = formContext.data.entity.getId();
            if (!invId) return;

            invId = invId.replace(/[{}]/g, "");

            Xrm.WebApi.retrieveMultipleRecords(
                "pdg_inventorytransaction",
                "?$select=pdg_transactiondate,pdg_transactiontype,pdg_quantity,pdg_unitcost,pdg_referencenumber" +
                "&$filter=_pdg_inventoryid_value eq " + invId +
                "&$orderby=pdg_transactiondate desc&$top=3"
            ).then(function (res) {
                if (!res.entities.length) return;

                var note = "Recent Activity: ";
                res.entities.forEach(function (t, index) {
                    if (index > 0) note += " | ";
                    var date = t.pdg_transactiondate ? new Date(t.pdg_transactiondate).toLocaleDateString() : "";
                    var type = t["pdg_transactiontype@OData.Community.Display.V1.FormattedValue"] || "Transaction";
                    var qty = t.pdg_quantity || 0;
                    note += date + " " + type + " Qty:" + qty;
                });

                notify(formContext, note, "INFO", "recent_activity", 8000);
            }).catch(function (e) {
                console.warn("loadRecentTransactions:", e);
            });
        },

        loadRelatedInventory: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            if (!item) return;

            var itemId = getLookupId(item);
            var currentId = formContext.data.entity.getId();

            var query = "?$select=pdg_displayname,pdg_onlinequantity,pdg_locationpath" +
                "&$filter=_pdg_itemid_value eq " + itemId +
                (currentId ? " and pdg_inventoryid ne " + currentId.replace(/[{}]/g, "") : "") +
                "&$top=3";

            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", query)
                .then(function (res) {
                    if (res.entities.length > 0) {
                        var note = "Other Locations: ";
                        res.entities.forEach(function (inv, index) {
                            if (index > 0) note += " | ";
                            var locationPath = inv.pdg_locationpath || "Unknown Location";
                            note += locationPath + " (" + (inv.pdg_onlinequantity || 0) + " available)";
                        });
                        notify(formContext, note, "INFO", "other_locations", 6000);
                    }
                }).catch(function (e) {
                    console.warn("loadRelatedInventory:", e);
                });
        },

        // ========= Helper Functions =========
        performInitialValidations: function (formContext) {
            this.recalculateQuantities(formContext);
            this.updateLocationPath(formContext);
            this.updateDisplayName(formContext);
            this.updateQuickActions(formContext);
            this.setupBarcodeImages(formContext);
            this.showUnitHints(formContext);
            this.renderSummary(formContext);
            if (this.updateStockBar) this.updateStockBar(formContext);
        },
        clearAllNotifications: function (formContext) {
            try {
                var ids = Object.keys(PDG._notifIds || {});
                ids.forEach(function (id) { clear(formContext, id); });
                PDG._notifIds = {};
                this.clearSummary(formContext);
            } catch (e) { }
        },

        // ========= Info Summary Aggregation =========
        addSummary: function (formContext, msg, id) {
            try {
                this._summary = this._summary || {};
                var item = this._parseSummaryItem(msg);
                var key = id || ("m_" + (item.label + "_" + (item.text || "")).length);
                this._summary[key] = item;
                this.renderSummary(formContext);
            } catch (e) { }
        },
        renderSummary: function (formContext) {
            try {
                var map = this._summary || {};
                var items = Object.keys(map).map(function (k) { return map[k]; });
                var text = items.length ? (items.map(function(i){ return (i.label ? (i.label + ": ") : "") + i.text; }).join(" | ")) : null;
                var id = "info_summary";
                if (text) {
                    formContext.ui.setFormNotification(text, "INFO", id);
                    PDG._notifIds[id] = true;
                } else {
                    clear(formContext, id);
                }

                // Also write a multi-line labeled list to the suggestions box as a summary area
                var summaryBox = attr(formContext, "pdg_quickaction");
                if (summaryBox) {
                    var ml = items.map(function (i) { return "- " + (i.label ? (i.label + ": ") : "") + i.text; }).join("\n");
                    summaryBox.setValue(ml || "");
                }
            } catch (e) { }
        },
        clearSummary: function (formContext) {
            try { this._summary = {}; clear(formContext, "info_summary"); } catch (e) { }
        },

        _parseSummaryItem: function (msg) {
            try {
                var m = msg || "";
                var parts = m.split(":");
                if (parts.length > 1) {
                    return { label: parts.shift().trim(), text: parts.join(":").trim() };
                }
                return { label: "Info", text: m };
            } catch (_) { return { label: "Info", text: String(msg || "") }; }
        },

        // Compute location barcode automatically from selected Bin
        updateLocationBarcodeFromBin: function (formContext) {
            try {
                var bin = attr(formContext, "pdg_binid") && attr(formContext, "pdg_binid").getValue();
                if (!bin) return;
                var binId = getLookupId(bin);
                var self = this;
                Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=pdg_bincode").then(function (b) {
                    if (b && b.pdg_bincode) {
                        self._suppressLocationBarcode = true;
                        setIf(formContext, "pdg_locationbarcode", b.pdg_bincode);
                        self.updateBarcodeImages(formContext);
                        setTimeout(function(){ self._suppressLocationBarcode = false; }, 50);
                    }
                });
            } catch (e) { console.warn("updateLocationBarcodeFromBin:", e); }
        },

        showWelcomeMessage: function (formContext) {
            var guidance = "Welcome to Enhanced Inventory Management! Start by selecting an Item and Warehouse.";
            notify(formContext, guidance, "INFO", "welcome", 8000);
        },

        showUnitHints: function (formContext) {
            // Non-blocking field hints to clarify units used in calculations
            if (ctrl(formContext, "pdg_volume")) {
                addControlInfo(formContext, "pdg_volume", "Per-unit volume; compared to Bin 'Capacity'. Ensure same unit.", "hint_volume_unit");
            }
            if (ctrl(formContext, "pdg_onhandquantity")) {
                addControlInfo(formContext, "pdg_onhandquantity", "Used for total volume = volume × on-hand.", "hint_onhand_total");
            }
        },

        // ========= Barcode Helpers =========
        setupBarcodeImages: function (formContext) {
            // Render existing values on load
            this.updateBarcodeImages(formContext);
        },

        updateBarcodeImages: function (formContext) {
            try {
                var itemCode = attr(formContext, "pdg_barcodescan") && attr(formContext, "pdg_barcodescan").getValue();
                var locCode = attr(formContext, "pdg_locationbarcode") && attr(formContext, "pdg_locationbarcode").getValue();
                this._renderBarcodeWebResource(formContext, "WebResource_ItemBarcode", itemCode || "");
                this._renderBarcodeWebResource(formContext, "WebResource_ItemQR", itemCode || "");
                this._renderBarcodeWebResource(formContext, "WebResource_LocationBarcode", locCode || "");
            } catch (e) {
                console.warn("updateBarcodeImages:", e);
            }
        },

        _renderBarcodeWebResource: function (formContext, controlId, value) {
            try {
                var c = ctrl(formContext, controlId);
                if (!c) return;
                if (typeof c.getContentWindow === 'function') {
                    c.getContentWindow().then(function (cw) {
                        try {
                            if (/QR/i.test(controlId) && cw && typeof cw.renderQR === 'function') { cw.renderQR(value || ''); return; }
                            if (cw && typeof cw.renderBarcode === 'function') { cw.renderBarcode(value || ''); return; }
                        } catch (_) { }
                        var src = (typeof c.getSrc === 'function') ? c.getSrc() : null;
                        var base = src ? src.split('?')[0] : ("/WebResources/" + (/QR/i.test(controlId) ? 'pdg_qr' : 'pdg_barcode'));
                        var qs = "?data=" + encodeURIComponent(value || "") + "&v=" + Date.now();
                        if (typeof c.setSrc === 'function') c.setSrc(base + qs);
                    });
                } else if (typeof c.setSrc === 'function') {
                    var src = (typeof c.getSrc === 'function') ? c.getSrc() : null;
                    var base = src ? src.split('?')[0] : ("/WebResources/" + (/QR/i.test(controlId) ? 'pdg_qr' : 'pdg_barcode'));
                    var qs = "?data=" + encodeURIComponent(value || "") + "&v=" + Date.now();
                    c.setSrc(base + qs);
                }
            } catch (e) {
                console.warn("render barcode webresource failed:", controlId, e);
            }
        },

        applyLocationBarcode: function (formContext) {
            var codeAttr = attr(formContext, "pdg_locationbarcode");
            var code = codeAttr && codeAttr.getValue();
            if (!code) return;

            var self = this;

            // Try to parse GUID directly first
            var guidMatch = code.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
            if (guidMatch) {
                var binId = guidMatch[0].replace(/[{}]/g, "");
                Xrm.WebApi.retrieveRecord("pdg_bin", binId, "?$select=pdg_binid,pdg_bincode,_pdg_warehouseid_value")
                    .then(function (bin) { self._applyBinSelection(formContext, bin); })
                    .catch(function (e) { console.warn("applyLocationBarcode (guid):", e); });
                return;
            }

            // Otherwise try bin code equality
            var filter = "?$select=pdg_binid,pdg_bincode,_pdg_warehouseid_value&$filter=pdg_bincode eq '" + (code || '').replace(/'/g, "''") + "'";
            Xrm.WebApi.retrieveMultipleRecords("pdg_bin", filter)
                .then(function (res) {
                    if (res.entities && res.entities.length > 0) {
                        self._applyBinSelection(formContext, res.entities[0]);
                    } else {
                        notify(formContext, "No bin found for scanned location code", "WARNING", "loc_barcode_not_found", 5000);
                    }
                })
                .catch(function (e) { console.warn("applyLocationBarcode (code):", e); });
        },

        _applyBinSelection: function (formContext, bin) {
            if (!bin) return;
            try {
                var binLookup = [{ id: bin.pdg_binid, name: bin.pdg_bincode || "Bin", entityType: "pdg_bin" }];
                setIf(formContext, "pdg_binid", binLookup);

                var whId = (bin._pdg_warehouseid_value || "").replace(/[{}]/g, "");
                if (whId) {
                    Xrm.WebApi.retrieveRecord("pdg_warehouse", whId, "?$select=pdg_warehouseid,pdg_name")
                        .then(function (wh) {
                            var whLookup = [{ id: wh.pdg_warehouseid, name: wh.pdg_name || "Warehouse", entityType: "pdg_warehouse" }];
                            setIf(formContext, "pdg_warehouseid", whLookup);
                        })
                        .catch(function (e) { console.warn("_applyBinSelection (warehouse load):", e); });
                }
            } catch (e) {
                console.warn("_applyBinSelection:", e);
            }
        },

        populateFromItem: function (formContext) {
            var itemDetails = formContext._itemDetails;
            if (itemDetails && itemDetails.stockSettings) {
                if (!attr(formContext, "pdg_minimumstock").getValue() && itemDetails.stockSettings.safetyStock) {
                    setIf(formContext, "pdg_minimumstock", itemDetails.stockSettings.safetyStock);
                }
                if (!attr(formContext, "pdg_maximumstock").getValue() && itemDetails.stockSettings.economicOrderQty) {
                    var maxStock = itemDetails.stockSettings.economicOrderQty * 2;
                    setIf(formContext, "pdg_maximumstock", maxStock);
                }
            }
        },

        updateCalculatedFields: function (formContext) {
            this.recalculateQuantities(formContext);
            this.updateLocationPath(formContext);
            this.updateDisplayName(formContext);
            this.updateStatusIndicator(formContext);
            this.updateQuickActions(formContext);
        },

        // ========= Business Actions =========
        quickCount: function (formContext) {
            var onhandAttr = attr(formContext, "pdg_onhandquantity");
            if (!onhandAttr) return;

            var current = num(onhandAttr.getValue());
            var itemName = getLookupName(attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue()) || "Item";

            Xrm.Navigation.openPrompt({
                text: "Enter the physical count for " + itemName,
                title: "Physical Inventory Count",
                value: String(current),
                subtitle: "Current system quantity: " + current
            }).then(function (res) {
                if (!res || res.cancelled) return;

                var counted = num(res.value);
                var variance = counted - current;

                onhandAttr.setValue(counted);
                setIf(formContext, "pdg_lastcountdate", now());
                setIf(formContext, "pdg_physicalcountdate", now());

                this.recalculateQuantities(formContext);

                if (variance !== 0) {
                    var varianceMsg = "Count Variance: " + (variance > 0 ? "+" : "") + variance;
                    if (Math.abs(variance) > current * 0.1) {
                        varianceMsg += " (Significant variance detected)";
                    }
                    notify(formContext, varianceMsg, variance > 0 ? "INFO" : "WARNING", "count_variance", 8000);
                }

                formContext.data.save().then(function () {
                    notify(formContext, "Physical count completed and saved", "INFO", "count_success", 3000);
                });
            }.bind(this));
        }
    };

    // Expose functions globally for ribbon buttons
    window.PDGInventory = PDG.Inventory;
})();


