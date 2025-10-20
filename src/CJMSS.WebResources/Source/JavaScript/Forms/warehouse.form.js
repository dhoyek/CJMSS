/* === PDG Warehouse Form === */
var PDG = PDG || {};
PDG.Warehouse = (function () {
    "use strict";

    var ns = {};

    ns.ENUMS = {
        ACCESS_LEVEL: {
            PUBLIC: 100100000,
            RESTRICTED: 100100001,
            PRIVATE: 100100002
        },
        SECURITY_LEVEL: {
            LOW: 100100000,
            MEDIUM: 100100001,
            HIGH: 100100002,
            MAXIMUM: 100100003
        },
        WAREHOUSE_STATUS: {
            ACTIVE: 100100000,
            INACTIVE: 100100001
        },
        CYCLE_COUNT_FREQUENCY: {
            DAILY: 100000000,
            WEEKLY: 100000001,
            MONTHLY: 100000002
        },
        INVENTORY_METHOD: {
            PERPETUAL: 100100000,
            PERIODIC: 100100001,
            HYBRID: 100100002
        },
        VALUATION_METHOD: {
            FIFO: 100100000,
            LIFO: 100100001,
            AVERAGE: 100100002,
            STANDARD: 100100003
        }
    };

    ns.TABS = {
        OVERVIEW: "tab_overview",
        OPERATIONS: "tab_operations"
    };

    ns.SECTIONS = {
        OPERATIONS: {
            PRODUCTION: "section_operations_production",
            CYCLE: "section_operations_cycle"
        }
    };

    ns.MESSAGES = {
        ALLOW_PRODUCTION: "wh_allow_production",
        MANAGER_MISMATCH: "wh_manager_mismatch",
        DEFAULT_NOTICE: "wh_default_notice",
        DUPLICATE_CODE: "wh_duplicate_code",
        VALIDATION: "wh_validation",
        ACCESS_SECURITY: "wh_access_security"
    };

    ns._handlerCache = {};
    ns._state = {
        managerMismatch: false,
        lastCheckedCode: null,
        lastCheckedWarehouseId: null
    };

    ns.resolveFormContext = function (ctx) {
        if (!ctx) {
            if (typeof Xrm !== "undefined" && Xrm.Page) {
                return Xrm.Page;
            }
            throw new Error("Form context unavailable.");
        }
        if (typeof ctx.getFormContext === "function") {
            return ctx.getFormContext();
        }
        if (ctx.formContext) {
            return ctx.formContext;
        }
        if (ctx.ui && typeof ctx.getAttribute === "function") {
            return ctx;
        }
        if (typeof Xrm !== "undefined" && Xrm.Page) {
            return Xrm.Page;
        }
        throw new Error("Unable to resolve form context.");
    };

    ns.getAttribute = function (formContext, name) {
        try {
            return formContext.getAttribute(name);
        } catch (e) {
            return null;
        }
    };

    ns.getControl = function (formContext, name) {
        try {
            return formContext.getControl(name);
        } catch (e) {
            return null;
        }
    };

    ns.getValue = function (formContext, name) {
        var attr = ns.getAttribute(formContext, name);
        return attr ? attr.getValue() : null;
    };

    ns.setValue = function (formContext, name, value) {
        var attr = ns.getAttribute(formContext, name);
        if (attr) {
            attr.setValue(value);
        }
    };

    ns.setDisabled = function (formContext, name, disabled) {
        var ctrl = ns.getControl(formContext, name);
        if (ctrl) {
            ctrl.setDisabled(!!disabled);
        }
    };

    ns.setVisible = function (formContext, name, visible) {
        var ctrl = ns.getControl(formContext, name);
        if (ctrl) {
            ctrl.setVisible(!!visible);
        }
    };

    ns.setSectionVisible = function (formContext, tabName, sectionName, visible) {
        try {
            var tab = formContext.ui.tabs.get(tabName);
            if (!tab) {
                return;
            }
            var section = tab.sections.get(sectionName);
            if (section) {
                section.setVisible(visible);
            }
        } catch (e) {
            console.warn("Warehouse: unable to toggle section", tabName, sectionName, e);
        }
    };

    ns.bindOnChange = function (formContext, attributeName, handlerKey) {
        var attr = ns.getAttribute(formContext, attributeName);
        if (!attr || !handlerKey || typeof ns[handlerKey] !== "function") {
            return;
        }
        if (!ns._handlerCache[handlerKey]) {
            ns._handlerCache[handlerKey] = function (executionContext) {
                return ns[handlerKey](executionContext);
            };
        }
        try {
            attr.removeOnChange(ns._handlerCache[handlerKey]);
        } catch (e) {
            // ignore - happens first registration
        }
        attr.addOnChange(ns._handlerCache[handlerKey]);
    };

    ns.onLoad = function (executionContext) {
        var formContext = ns.resolveFormContext(executionContext);
        console.log("PDG Warehouse: onLoad");

        if (formContext.ui.getFormType() === 1) {
            ns.applyDefaults(formContext);
        }

        ns.registerHandlers(formContext);
        ns.configureLookups(formContext);
        ns.refreshUI(formContext);

        ns.onWarehouseCodeChange(formContext);
        if (formContext.ui.getFormType() !== 1) {
            ns.checkManagerValidity(formContext);
        }
    };

    ns.onSave = function (executionContext) {
        var formContext = ns.resolveFormContext(executionContext);
        console.log("PDG Warehouse: onSave");

        if (!ns.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }
        return true;
    };

    ns.applyDefaults = function (formContext) {
        var defaults = {
            "pdg_allowtransfer": true,
            "pdg_allowproduction": false,
            "pdg_isdefault": false,
            "pdg_negativestockallowed": false,
            "pdg_autoreorderenabled": false,
            "pdg_barcodescanenabled": true,
            "pdg_cyclecountenabled": false,
            "pdg_cyclecountfrequency": ns.ENUMS.CYCLE_COUNT_FREQUENCY.MONTHLY,
            "pdg_inventorymethod": ns.ENUMS.INVENTORY_METHOD.PERPETUAL,
            "pdg_valuationmethod": ns.ENUMS.VALUATION_METHOD.AVERAGE,
            "pdg_accesslevel": ns.ENUMS.ACCESS_LEVEL.PUBLIC,
            "pdg_securitylevel": ns.ENUMS.SECURITY_LEVEL.LOW,
            "pdg_operatinghours": "08:00-17:00",
            "pdg_workingdays": "Monday-Friday"
        };

        Object.keys(defaults).forEach(function (field) {
            var attr = ns.getAttribute(formContext, field);
            if (attr && (attr.getValue() === null || attr.getValue() === undefined)) {
                attr.setValue(defaults[field]);
            }
        });
    };

    ns.registerHandlers = function (formContext) {
        ns.bindOnChange(formContext, "pdg_businessunitid", "onBusinessUnitChange");
        ns.bindOnChange(formContext, "pdg_managerid", "onManagerChange");
        ns.bindOnChange(formContext, "pdg_allowproduction", "onAllowProductionChange");
        ns.bindOnChange(formContext, "pdg_isdefault", "onIsDefaultChange");
        ns.bindOnChange(formContext, "pdg_warehousetype", "onWarehouseTypeChange");
        ns.bindOnChange(formContext, "pdg_accesslevel", "onAccessOrSecurityChange");
        ns.bindOnChange(formContext, "pdg_securitylevel", "onAccessOrSecurityChange");
        ns.bindOnChange(formContext, "pdg_cyclecountenabled", "onCycleCountEnabledChange");
        ns.bindOnChange(formContext, "pdg_warehousename", "onWarehouseCodeChange");
    };

    ns.configureLookups = function (formContext) {
        var managerControl = ns.getControl(formContext, "pdg_managerid");
        if (managerControl) {
            managerControl.addPreSearch(function () {
                ns.addManagerFilter(formContext);
            });
        }
    };

    ns.refreshUI = function (formContext) {
        ns.onBusinessUnitChange(formContext);
        ns.onAllowProductionChange(formContext);
        ns.onIsDefaultChange(formContext);
        ns.onWarehouseTypeChange(formContext);
        ns.onAccessOrSecurityChange(formContext);
        ns.onCycleCountEnabledChange(formContext);
    };

    ns.onBusinessUnitChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);

        ns.addManagerFilter(formContext);

        var manager = ns.getValue(formContext, "pdg_managerid");
        if (manager) {
            ns.checkManagerValidity(formContext);
        } else {
            formContext.ui.clearFormNotification(ns.MESSAGES.MANAGER_MISMATCH);
            ns._state.managerMismatch = false;
        }
    };

    ns.onManagerChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);
        ns.checkManagerValidity(formContext);
    };

    ns.onAllowProductionChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);
        var allow = !!ns.getValue(formContext, "pdg_allowproduction");

        if (allow) {
            formContext.ui.setFormNotification(
                "Production is enabled. Ensure production processes and safety checks are configured.",
                "INFO",
                ns.MESSAGES.ALLOW_PRODUCTION
            );
        } else {
            formContext.ui.clearFormNotification(ns.MESSAGES.ALLOW_PRODUCTION);
        }

        var dependentFields = [
            "pdg_requiresauthorization",
            "pdg_requiresapprovalfortransfers",
            "pdg_authorizedusers",
            "pdg_approvallimit"
        ];
        dependentFields.forEach(function (fieldName) {
            ns.setVisible(formContext, fieldName, allow);
            ns.setDisabled(formContext, fieldName, !allow);
        });
    };

    ns.onCycleCountEnabledChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);
        var enabled = !!ns.getValue(formContext, "pdg_cyclecountenabled");
        ns.setDisabled(formContext, "pdg_cyclecountfrequency", !enabled);
        ns.setVisible(formContext, "pdg_cyclecountfrequency", enabled);
    };

    ns.onIsDefaultChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);
        var isDefault = !!ns.getValue(formContext, "pdg_isdefault");
        var businessUnit = ns.getValue(formContext, "pdg_businessunitid");

        if (isDefault && !businessUnit) {
            formContext.ui.setFormNotification(
                "Set a Business Unit before marking this warehouse as default.",
                "WARNING",
                ns.MESSAGES.DEFAULT_NOTICE
            );
        } else if (isDefault) {
            formContext.ui.setFormNotification(
                "Save to confirm this warehouse as the default for the selected business unit.",
                "INFO",
                ns.MESSAGES.DEFAULT_NOTICE
            );
        } else {
            formContext.ui.clearFormNotification(ns.MESSAGES.DEFAULT_NOTICE);
        }
    };

    ns.onWarehouseTypeChange = function (ctx) {
        // Placeholder for future type-specific logic
        ns.resolveFormContext(ctx);
    };

    ns.onAccessOrSecurityChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);
        var accessLevel = ns.getValue(formContext, "pdg_accesslevel");
        var securityLevel = ns.getValue(formContext, "pdg_securitylevel");

        if (accessLevel === ns.ENUMS.ACCESS_LEVEL.PUBLIC && securityLevel >= ns.ENUMS.SECURITY_LEVEL.HIGH) {
            formContext.ui.setFormNotification(
                "Public access with high security may conflict. Review the combination.",
                "WARNING",
                ns.MESSAGES.ACCESS_SECURITY
            );
        } else {
            formContext.ui.clearFormNotification(ns.MESSAGES.ACCESS_SECURITY);
        }
    };

    ns.onWarehouseCodeChange = function (ctx) {
        var formContext = ns.resolveFormContext(ctx);
        ns.formatWarehouseCode(formContext);
        ns.checkDuplicateCodeAsync(formContext);
    };

    ns.formatWarehouseCode = function (formContext) {
        var attr = ns.getAttribute(formContext, "pdg_warehousename");
        if (!attr) {
            return;
        }
        var value = attr.getValue();
        if (!value || typeof value !== "string") {
            return;
        }
        var cleaned = value.trim().toUpperCase();
        if (cleaned !== value) {
            attr.setValue(cleaned);
        }
    };

    ns.addManagerFilter = function (formContext) {
        var businessUnit = ns.getValue(formContext, "pdg_businessunitid");
        var managerControl = ns.getControl(formContext, "pdg_managerid");
        if (!managerControl) {
            return;
        }

        var filter = "<filter type='and'><condition attribute='isdisabled' operator='eq' value='false' />";
        if (businessUnit && businessUnit.length) {
            filter += "<condition attribute='businessunitid' operator='eq' value='" + ns.cleanGuid(businessUnit[0].id) + "' />";
        }
        filter += "</filter>";

        managerControl.addCustomFilter(filter, "systemuser");
    };

    ns.checkManagerValidity = function (formContext) {
        var manager = ns.getValue(formContext, "pdg_managerid");
        var businessUnit = ns.getValue(formContext, "pdg_businessunitid");

        ns._state.managerMismatch = false;
        formContext.ui.clearFormNotification(ns.MESSAGES.MANAGER_MISMATCH);

        if (!manager || !businessUnit) {
            return Promise.resolve(true);
        }

        var managerId = ns.cleanGuid(manager[0].id);
        var businessUnitId = ns.cleanGuid(businessUnit[0].id);

        return Xrm.WebApi.retrieveRecord("systemuser", managerId, "?$select=fullname,_businessunitid_value")
            .then(function (result) {
                var managerBU = ns.cleanGuid(result._businessunitid_value);
                var matches = managerBU === businessUnitId;

                ns._state.managerMismatch = !matches;

                if (!matches) {
                    var managerName = result.fullname || manager[0].name;
                    formContext.ui.setFormNotification(
                        managerName + " belongs to a different Business Unit. Select a manager from the chosen unit.",
                        "WARNING",
                        ns.MESSAGES.MANAGER_MISMATCH
                    );
                } else {
                    formContext.ui.clearFormNotification(ns.MESSAGES.MANAGER_MISMATCH);
                }
                return matches;
            })
            .catch(function (error) {
                console.warn("Warehouse: checkManagerValidity failed", error);
                return true;
            });
    };

    ns.checkDuplicateCodeAsync = function (formContext) {
        var code = ns.getValue(formContext, "pdg_warehousename");
        var recordIdRaw = formContext.data && formContext.data.entity && formContext.data.entity.getId
            ? formContext.data.entity.getId()
            : null;
        var recordId = recordIdRaw ? ns.cleanGuid(recordIdRaw) : null;

        if (!code) {
            formContext.ui.clearFormNotification(ns.MESSAGES.DUPLICATE_CODE);
            ns._state.lastCheckedCode = null;
            ns._state.lastCheckedWarehouseId = null;
            return Promise.resolve();
        }

        if (ns._state.lastCheckedCode === code && ns._state.lastCheckedWarehouseId === recordId) {
            return Promise.resolve();
        }

        ns._state.lastCheckedCode = code;
        ns._state.lastCheckedWarehouseId = recordId;

        var encoded = code.replace(/'/g, "''");
        var filter = "?$select=pdg_warehousename&$top=1&$filter=pdg_warehousename eq '" + encoded + "' and statecode eq 0";
        if (recordId) {
            filter += " and pdg_warehouseid ne " + recordId;
        }

        return Xrm.WebApi.retrieveMultipleRecords("pdg_warehouse", filter)
            .then(function (result) {
                if (result.entities.length) {
                    formContext.ui.setFormNotification(
                        "Another active warehouse already uses this code.",
                        "ERROR",
                        ns.MESSAGES.DUPLICATE_CODE
                    );
                } else {
                    formContext.ui.clearFormNotification(ns.MESSAGES.DUPLICATE_CODE);
                }
            })
            .catch(function (error) {
                console.warn("Warehouse: duplicate check failed", error);
            });
    };

    ns.validate = function (formContext) {
        var fieldsToClear = [
            "pdg_warehousename",
            "pdg_longname",
            "pdg_businessunitid",
            "pdg_managerid",
            "pdg_capacity"
        ];
        fieldsToClear.forEach(function (field) {
            var ctrl = ns.getControl(formContext, field);
            if (ctrl && typeof ctrl.clearNotification === "function") {
                ctrl.clearNotification();
            }
        });
        formContext.ui.clearFormNotification(ns.MESSAGES.VALIDATION);

        var errors = [];

        if (!ns.getValue(formContext, "pdg_warehousename")) {
            errors.push({ field: "pdg_warehousename", message: "Warehouse Code is required." });
        }
        if (!ns.getValue(formContext, "pdg_longname")) {
            errors.push({ field: "pdg_longname", message: "Warehouse Name is required." });
        }
        if (!ns.getValue(formContext, "pdg_businessunitid")) {
            errors.push({ field: "pdg_businessunitid", message: "Business Unit is required." });
        }

        var capacity = ns.getValue(formContext, "pdg_capacity");
        if (capacity !== null && capacity !== undefined && capacity !== "") {
            var numericCapacity = parseFloat(capacity);
            if (!isNaN(numericCapacity) && numericCapacity < 0) {
                errors.push({ field: "pdg_capacity", message: "Capacity cannot be negative." });
            }
        }

        var isDefault = !!ns.getValue(formContext, "pdg_isdefault");
        if (isDefault && !ns.getValue(formContext, "pdg_businessunitid")) {
            errors.push({ field: "pdg_businessunitid", message: "Business Unit is required for default warehouse." });
        }

        if (!errors.length) {
            return true;
        }

        errors.forEach(function (err) {
            var ctrl = ns.getControl(formContext, err.field);
            if (ctrl && typeof ctrl.setNotification === "function") {
                ctrl.setNotification(err.message);
            }
        });

        formContext.ui.setFormNotification(
            "Warehouse form validation failed. Review highlighted fields.",
            "ERROR",
            ns.MESSAGES.VALIDATION
        );

        return false;
    };

    ns.cleanGuid = function (value) {
        if (!value) {
            return "";
        }
        return value.replace(/[{}]/g, "");
    };

    return ns;
})();
