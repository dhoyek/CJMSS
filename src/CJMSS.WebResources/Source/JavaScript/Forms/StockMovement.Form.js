// Stock Movement Form JavaScript
// Following the PDG namespace pattern

if (typeof (PDG) === "undefined") {
    PDG = {};
}
if (typeof (PDG.StockMovement) === "undefined") {
    PDG.StockMovement = {};
}

// Movement type constants
PDG.StockMovement.MOVEMENT_TYPES = {
    TRANSFER: 100000001,
    ADJUSTMENT: 100000002,
    PRODUCTION: 100000003
};

// ===== MAIN FORM EVENTS =====

PDG.StockMovement.onLoad = function (executionContext) {
    let formContext;
    try {
        formContext = executionContext.getFormContext();

        // Basic setup
        PDG.StockMovement.initializeForm(formContext);

        // Setup field change handlers
        PDG.StockMovement.setupChangeHandlers(formContext);

        // Initialize movement type logic
        PDG.StockMovement.initializeMovementType(formContext);

        // Setup quantity calculations
        PDG.StockMovement.setupQuantityCalculations(formContext);

        // Initialize authorization logic
        PDG.StockMovement.initializeAuthorization(formContext);

        // Basic validation
        PDG.StockMovement.validateStockMovement(formContext);

        // Form type specific logic
        const formType = formContext.ui.getFormType();
        if (formType === 1) { // Create
            PDG.StockMovement.onCreateForm(formContext);
        } else if (formType === 2) { // Update
            PDG.StockMovement.onUpdateForm(formContext);
        }

    } catch (error) {
        console.error("Error in PDG.StockMovement.onLoad:", error);
        PDG.StockMovement.showNotification(formContext, "Error initializing form: " + error.message, "ERROR");
    }
};

PDG.StockMovement.onSave = function (executionContext) {
    try {
        const formContext = executionContext.getFormContext();

        // Validate before save
        if (!PDG.StockMovement.validateBeforeSave(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return;
        }

        // Update calculated fields
        PDG.StockMovement.updateCalculatedFields(formContext);

        // Set system fields
        PDG.StockMovement.setSystemFields(formContext);

    } catch (error) {
        console.error("Error in PDG.StockMovement.onSave:", error);
        PDG.StockMovement.showNotification(formContext, "Error saving form: " + error.message, "ERROR");
        executionContext.getEventArgs().preventDefault();
    }
};

// ===== INITIALIZATION FUNCTIONS =====

PDG.StockMovement.initializeForm = function (formContext) {
    try {
        // Set default values for new records
        var formType = formContext.ui.getFormType();
        if (formType === 1) { // Create
            // Set default movement date to today
            var movementDateAttr = formContext.getAttribute("pdg_movementdate");
            if (movementDateAttr && !movementDateAttr.getValue()) {
                movementDateAttr.setValue(new Date());
            }

            // Set default values
            var postedAttr = formContext.getAttribute("pdg_posted");
            if (postedAttr && postedAttr.getValue() === null) {
                postedAttr.setValue(false);
            }

            var systemGeneratedAttr = formContext.getAttribute("pdg_systemgenerated");
            if (systemGeneratedAttr && systemGeneratedAttr.getValue() === null) {
                systemGeneratedAttr.setValue(false);
            }

            // Auto-populate performed by with current user
            PDG.StockMovement.setCurrentUserAsPerformedBy(formContext);
        }

        // Setup form layout based on movement type
        PDG.StockMovement.adjustFormLayout(formContext);

    } catch (error) {
        console.warn("Error in initializeForm:", error);
    }
};

PDG.StockMovement.setupChangeHandlers = function (formContext) {
    try {
        // Movement Type change handler
        var movementTypeAttr = formContext.getAttribute("pdg_movementtype");
        if (movementTypeAttr) {
            movementTypeAttr.addOnChange(PDG.StockMovement.onMovementTypeChange);
        }

        // Item change handler
        var itemAttr = formContext.getAttribute("pdg_itemid");
        if (itemAttr) {
            itemAttr.addOnChange(PDG.StockMovement.onItemChange);
        }

        // Inventory change handler
        var inventoryAttr = formContext.getAttribute("pdg_inventoryid");
        if (inventoryAttr) {
            inventoryAttr.addOnChange(PDG.StockMovement.onInventoryChange);
        }

        // Warehouse change handler
        var warehouseAttr = formContext.getAttribute("pdg_warehouseid");
        if (warehouseAttr) {
            warehouseAttr.addOnChange(PDG.StockMovement.onWarehouseChange);
        }

        // Quantity changed handler
        var quantityChangedAttr = formContext.getAttribute("pdg_quantitychanged");
        if (quantityChangedAttr) {
            quantityChangedAttr.addOnChange(PDG.StockMovement.onQuantityChanged);
        }

        // Posted status change handler
        var postedAttr = formContext.getAttribute("pdg_posted");
        if (postedAttr) {
            postedAttr.addOnChange(PDG.StockMovement.onPostedStatusChange);
        }

    } catch (error) {
        console.warn("Error setting up change handlers:", error);
    }
};

// ===== EVENT HANDLERS =====

PDG.StockMovement.onMovementTypeChange = function (executionContext) {
    try {
        const formContext = executionContext.getFormContext();
        PDG.StockMovement.adjustFormLayout(formContext);
        PDG.StockMovement.updateRequiredFields(formContext);
    } catch (error) {
        console.warn("Error in onMovementTypeChange:", error);
    }
};

PDG.StockMovement.onItemChange = async function (executionContext) {
    try {
        const formContext = executionContext.getFormContext();
        const itemAttr = formContext.getAttribute("pdg_itemid");

        if (itemAttr && itemAttr.getValue()) {
            await PDG.StockMovement.loadItemDetails(formContext, itemAttr.getValue()[0].id);
            PDG.StockMovement.filterInventoryByItem(formContext);
        } else {
            PDG.StockMovement.clearDependentFields(formContext);
        }
    } catch (error) {
        console.warn("Error in onItemChange:", error);
    }
};

PDG.StockMovement.onInventoryChange = async function (executionContext) {
    try {
        const formContext = executionContext.getFormContext();
        const inventoryAttr = formContext.getAttribute("pdg_inventoryid");

        if (inventoryAttr && inventoryAttr.getValue()) {
            await PDG.StockMovement.loadInventoryQuantities(formContext, inventoryAttr.getValue()[0].id);
        }
    } catch (error) {
        console.warn("Error in onInventoryChange:", error);
    }
};

PDG.StockMovement.onWarehouseChange = function (executionContext) {
    try {
        var formContext = executionContext.getFormContext();
        // Update bin options based on warehouse
        PDG.StockMovement.updateBinOptions(formContext);
    } catch (error) {
        console.warn("Error in onWarehouseChange:", error);
    }
};

PDG.StockMovement.onQuantityChanged = function (executionContext) {
    try {
        var formContext = executionContext.getFormContext();
        PDG.StockMovement.calculateQuantityAfter(formContext);
        PDG.StockMovement.validateQuantityChange(formContext);
    } catch (error) {
        console.warn("Error in onQuantityChanged:", error);
    }
};

PDG.StockMovement.onPostedStatusChange = function (executionContext) {
    try {
        var formContext = executionContext.getFormContext();
        var postedAttr = formContext.getAttribute("pdg_posted");

        if (postedAttr && postedAttr.getValue()) {
            // Set posting date to now
            var postingDateAttr = formContext.getAttribute("pdg_postingdate");
            if (postingDateAttr && !postingDateAttr.getValue()) {
                postingDateAttr.setValue(new Date());
            }

            // Lock certain fields when posted
            PDG.StockMovement.lockFieldsWhenPosted(formContext);
        } else {
            // Clear posting date when unposted
            var postingDateAttr = formContext.getAttribute("pdg_postingdate");
            if (postingDateAttr) {
                postingDateAttr.setValue(null);
            }

            // Unlock fields
            PDG.StockMovement.unlockFields(formContext);
        }
    } catch (error) {
        console.warn("Error in onPostedStatusChange:", error);
    }
};

// ===== BUSINESS LOGIC FUNCTIONS =====

PDG.StockMovement.calculateQuantityAfter = function (formContext) {
    try {
        var quantityBeforeAttr = formContext.getAttribute("pdg_quantitybefore");
        var quantityChangedAttr = formContext.getAttribute("pdg_quantitychanged");
        var quantityAfterAttr = formContext.getAttribute("pdg_quantityafter");

        if (quantityBeforeAttr && quantityChangedAttr && quantityAfterAttr) {
            var quantityBefore = quantityBeforeAttr.getValue() || 0;
            var quantityChanged = quantityChangedAttr.getValue() || 0;
            var quantityAfter = quantityBefore + quantityChanged;

            quantityAfterAttr.setValue(quantityAfter);

            // Show warning for negative quantities
            if (quantityAfter < 0) {
                PDG.StockMovement.showNotification(formContext, "Warning: Resulting quantity will be negative", "WARNING");
            }
        }
    } catch (error) {
        console.warn("Error in calculateQuantityAfter:", error);
    }
};

PDG.StockMovement.loadInventoryQuantities = async function (formContext, inventoryId) {
    try {
        if (!inventoryId) return;

        // Retrieve inventory record to get current quantities
        const result = await Xrm.WebApi.retrieveRecord(
            "pdg_inventory",
            inventoryId,
            "?$select=pdg_onhandquantity,pdg_onlinequantity,pdg_costprice,pdg_unitcost"
        );

        // Update quantity before field
        const quantityBeforeAttr = formContext.getAttribute("pdg_quantitybefore");
        if (quantityBeforeAttr) {
            quantityBeforeAttr.setValue(result.pdg_onhandquantity || 0);
        }

        // Update unit cost before field
        const unitCostBeforeAttr = formContext.getAttribute("pdg_unitcostbefore");
        if (unitCostBeforeAttr) {
            unitCostBeforeAttr.setValue(result.pdg_costprice || result.pdg_unitcost || 0);
        }

        // Recalculate quantity after
        PDG.StockMovement.calculateQuantityAfter(formContext);

    } catch (error) {
        console.warn("Error retrieving inventory quantities:", error.message || error);
    }
};

PDG.StockMovement.loadItemDetails = async function (formContext, itemId) {
    try {
        if (!itemId) return;

        // Retrieve item details
        const result = await Xrm.WebApi.retrieveRecord(
            "pdg_inventoryitem",
            itemId,
            "?$select=pdg_itemname,pdg_itemcode,pdg_serialtracking"
        );

        // Update serial number field visibility based on item tracking
        if (result.pdg_serialtracking) {
            PDG.StockMovement.showSerialNumberField(formContext);
        } else {
            PDG.StockMovement.hideSerialNumberField(formContext);
        }

    } catch (error) {
        console.warn("Error retrieving item details:", error.message || error);
    }
};

PDG.StockMovement.filterInventoryByItem = function (formContext) {
    try {
        var itemAttr = formContext.getAttribute("pdg_itemid");
        if (!itemAttr || !itemAttr.getValue()) return;

        var itemId = itemAttr.getValue()[0].id;

        // Set lookup filter for inventory
        var inventoryControl = formContext.getControl("pdg_inventoryid");
        if (inventoryControl) {
            var filter = "<filter type='and'>" +
                "<condition attribute='pdg_itemid' operator='eq' value='" + itemId + "' />" +
                "</filter>";
            inventoryControl.addCustomFilter(filter, "pdg_inventory");
        }
    } catch (error) {
        console.warn("Error in filterInventoryByItem:", error);
    }
};

// ===== VALIDATION FUNCTIONS =====

PDG.StockMovement.validateStockMovement = function (formContext) {
    try {
        PDG.StockMovement.validateBeforeSave(formContext);
    } catch (error) {
        console.warn("Error in validateStockMovement:", error);
    }
};

PDG.StockMovement.validateBeforeSave = function (formContext) {
    try {
        let isValid = true;
        const errorMessages = [];

        // Validate required fields
        if (!PDG.StockMovement.validateRequiredFields(formContext)) {
            isValid = false;
            errorMessages.push("Please fill in all required fields.");
        }

        // Validate movement type specific requirements
        if (!PDG.StockMovement.validateMovementTypeRequirements(formContext)) {
            isValid = false;
            errorMessages.push("Please complete movement type specific requirements.");
        }

        // Validate quantities
        if (!PDG.StockMovement.validateQuantities(formContext)) {
            isValid = false;
            errorMessages.push("Please check quantity values.");
        }

        // Validate authorization
        if (!PDG.StockMovement.validateAuthorization(formContext)) {
            isValid = false;
            errorMessages.push("Authorization required for this movement type.");
        }

        // Show validation errors
        if (!isValid) {
            PDG.StockMovement.showNotification(formContext, errorMessages.join(" "), "ERROR");
        }

        return isValid;

    } catch (error) {
        console.error("Error in validateBeforeSave:", error);
        return false;
    }
};

PDG.StockMovement.validateQuantities = function (formContext) {
    try {
        var quantityChangedAttr = formContext.getAttribute("pdg_quantitychanged");

        if (quantityChangedAttr) {
            var quantityChanged = quantityChangedAttr.getValue();

            if (quantityChanged === null || quantityChanged === 0) {
                return false;
            }
        }

        return true;
    } catch (error) {
        console.warn("Error in validateQuantities:", error);
        return false;
    }
};

PDG.StockMovement.validateAuthorization = function (formContext) {
    try {
        const movementTypeAttr = formContext.getAttribute("pdg_movementtype");
        const authorizedByAttr = formContext.getAttribute("pdg_authorizedby");

        if (movementTypeAttr && movementTypeAttr.getValue()) {
            const movementType = movementTypeAttr.getValue();

            // Check if authorization is required for this movement type
            const requiresAuthorization = [
                PDG.StockMovement.MOVEMENT_TYPES.TRANSFER,
                PDG.StockMovement.MOVEMENT_TYPES.ADJUSTMENT
            ];

            if (requiresAuthorization.includes(movementType)) {
                if (!authorizedByAttr || !authorizedByAttr.getValue()) {
                    return false;
                }
            }
        }

        return true;
    } catch (error) {
        console.warn("Error in validateAuthorization:", error);
        return true; // Default to valid if validation fails
    }
};

// ===== UI MANAGEMENT FUNCTIONS =====

PDG.StockMovement.adjustFormLayout = function (formContext) {
    try {
        const movementTypeAttr = formContext.getAttribute("pdg_movementtype");

        if (movementTypeAttr && movementTypeAttr.getValue()) {
            const movementType = movementTypeAttr.getValue();

            // Show/hide fields based on movement type
            switch (movementType) {
                case PDG.StockMovement.MOVEMENT_TYPES.TRANSFER:
                    PDG.StockMovement.showTransferFields(formContext);
                    break;
                case PDG.StockMovement.MOVEMENT_TYPES.ADJUSTMENT:
                    PDG.StockMovement.showAdjustmentFields(formContext);
                    break;
                case PDG.StockMovement.MOVEMENT_TYPES.PRODUCTION:
                    PDG.StockMovement.showProductionFields(formContext);
                    break;
                default:
                    PDG.StockMovement.showDefaultFields(formContext);
                    break;
            }
        }
    } catch (error) {
        console.warn("Error in adjustFormLayout:", error);
    }
};

PDG.StockMovement.showTransferFields = function (formContext) {
    try {
        // Show bin fields for transfers
        PDG.StockMovement.setFieldVisibility(formContext, "pdg_frombin", true);
        PDG.StockMovement.setFieldVisibility(formContext, "pdg_tobin", true);

        // Make reason code required
        PDG.StockMovement.setFieldRequirement(formContext, "pdg_reasoncode", "required");
    } catch (error) {
        console.warn("Error in showTransferFields:", error);
    }
};

PDG.StockMovement.showAdjustmentFields = function (formContext) {
    try {
        // Show reason code as required for adjustments
        PDG.StockMovement.setFieldRequirement(formContext, "pdg_reasoncode", "required");

        // Show reference document
        PDG.StockMovement.setFieldVisibility(formContext, "pdg_referencedocument", true);
    } catch (error) {
        console.warn("Error in showAdjustmentFields:", error);
    }
};

PDG.StockMovement.lockFieldsWhenPosted = function (formContext) {
    try {
        var fieldsToLock = [
            "pdg_movementtype", "pdg_itemid", "pdg_inventoryid", "pdg_warehouseid",
            "pdg_quantitychanged", "pdg_frombin", "pdg_tobin", "pdg_reasoncode"
        ];

        fieldsToLock.forEach(function (fieldName) {
            var control = formContext.getControl(fieldName);
            if (control) {
                control.setDisabled(true);
            }
        });
    } catch (error) {
        console.warn("Error in lockFieldsWhenPosted:", error);
    }
};

// ===== UTILITY FUNCTIONS =====

PDG.StockMovement.setFieldVisibility = function (formContext, fieldName, visible) {
    try {
        var control = formContext.getControl(fieldName);
        if (control) {
            control.setVisible(visible);
        }
    } catch (error) {
        console.warn("Error setting field visibility for " + fieldName + ":", error);
    }
};

PDG.StockMovement.setFieldRequirement = function (formContext, fieldName, requirement) {
    try {
        var attribute = formContext.getAttribute(fieldName);
        if (attribute) {
            attribute.setRequiredLevel(requirement);
        }
    } catch (error) {
        console.warn("Error setting field requirement for " + fieldName + ":", error);
    }
};

PDG.StockMovement.setCurrentUserAsPerformedBy = function (formContext) {
    try {
        var performedByAttr = formContext.getAttribute("pdg_performedbyid");
        if (performedByAttr && !performedByAttr.getValue()) {
            var currentUser = Xrm.Utility.getGlobalContext().userSettings;
            if (currentUser && currentUser.userId) {
                performedByAttr.setValue([{
                    id: currentUser.userId,
                    name: currentUser.userName,
                    entityType: "systemuser"
                }]);
            }
        }
    } catch (error) {
        console.warn("Error in setCurrentUserAsPerformedBy:", error);
    }
};

PDG.StockMovement.showNotification = function (formContext, message, type) {
    try {
        var notificationType = "INFO";

        switch (type) {
            case "ERROR":
                notificationType = "ERROR";
                break;
            case "WARNING":
                notificationType = "WARNING";
                break;
            default:
                notificationType = "INFO";
                break;
        }

        formContext.ui.setFormNotification(message, notificationType, "stockmovement_notification");
    } catch (error) {
        console.warn("Error showing notification:", error);
    }
};

PDG.StockMovement.clearNotifications = function (formContext) {
    try {
        formContext.ui.clearFormNotification("stockmovement_notification");
    } catch (error) {
        console.warn("Error clearing notifications:", error);
    }
};

// ===== FORM TYPE SPECIFIC FUNCTIONS =====

PDG.StockMovement.onCreateForm = function (formContext) {
    try {
        // Set default posting status
        var postedAttr = formContext.getAttribute("pdg_posted");
        if (postedAttr) {
            postedAttr.setValue(false);
        }

    } catch (error) {
        console.warn("Error in onCreateForm:", error);
    }
};

PDG.StockMovement.onUpdateForm = function (formContext) {
    try {
        // Check if movement is posted and lock fields accordingly
        var postedAttr = formContext.getAttribute("pdg_posted");
        if (postedAttr && postedAttr.getValue()) {
            PDG.StockMovement.lockFieldsWhenPosted(formContext);
        }

    } catch (error) {
        console.warn("Error in onUpdateForm:", error);
    }
};

// ===== INITIALIZATION HELPERS =====

PDG.StockMovement.initializeMovementType = function (formContext) {
    try {
        // Set movement type specific logic
        PDG.StockMovement.adjustFormLayout(formContext);
    } catch (error) {
        console.warn("Error in initializeMovementType:", error);
    }
};

PDG.StockMovement.initializeAuthorization = function (formContext) {
    try {
        // Check user permissions and set authorization requirements
        var currentUserId = Xrm.Utility.getGlobalContext().userSettings.userId;

        // You would implement role-based authorization logic here

    } catch (error) {
        console.warn("Error in initializeAuthorization:", error);
    }
};

PDG.StockMovement.setupQuantityCalculations = function (formContext) {
    try {
        // Initialize quantity calculations
        PDG.StockMovement.calculateQuantityAfter(formContext);
    } catch (error) {
        console.warn("Error in setupQuantityCalculations:", error);
    }
};

// Additional helper functions for specific movement types
PDG.StockMovement.clearDependentFields = function (formContext) {
    try {
        var fieldsToClear = ["pdg_inventoryid", "pdg_quantitybefore", "pdg_unitcostbefore"];

        fieldsToClear.forEach(function (fieldName) {
            var attr = formContext.getAttribute(fieldName);
            if (attr) {
                attr.setValue(null);
            }
        });
    } catch (error) {
        console.warn("Error in clearDependentFields:", error);
    }
};

PDG.StockMovement.updateBinOptions = function (formContext) {
    try {
        var warehouseAttr = formContext.getAttribute("pdg_warehouseid");
        if (!warehouseAttr || !warehouseAttr.getValue()) return;

        // You would implement bin filtering logic based on warehouse here

    } catch (error) {
        console.warn("Error in updateBinOptions:", error);
    }
};