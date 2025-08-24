// --- Regulatory Class Choice Field ---
const makePicklist = (logical, display, required, desc, options, defaultValue) => ({
    "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
    "SchemaName": toSchema(logical),
    "DisplayName": label(display),
    "RequiredLevel": { "Value": required },
    "Description": label(desc),
    "DefaultFormValue": defaultValue,
    "OptionSet": {
        "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
        "IsGlobal": true,
        "Options": options.map(([value, labelText]) => ({
            Value: value,
            Label: label(labelText)
        }))
    }
});

// Define options
const regulatoryOptions = [
    [100000000, "Standard"],
    [100000001, "Controlled Substance"],
    [100000002, "Hazardous Material"],
    [100000003, "Medical Device"],
    [100000004, "Food Grade"],
    [100000005, "Explosive"],
    [100000006, "Radioactive"],
    [100000007, "Restricted Export"],
    [100000008, "Prescription Only"],
    [100000009, "Environmental"]
];

// Add to work queue
work.push(makePicklist(
    "pdg_regulatoryclass",
    "Regulatory Class",
    RECOMMENDED,
    "Regulatory classification of the item",
    regulatoryOptions,
    100000000 // Default: Standard
));
