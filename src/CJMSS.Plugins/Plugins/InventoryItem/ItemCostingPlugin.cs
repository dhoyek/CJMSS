using System;
using Microsoft.Xrm.Sdk;

namespace CJMSS.Plugins.Plugins.InventoryItem
{
    /// <summary>
    /// Sample plugin for pdg_inventoryitem that demonstrates common patterns:
    ///  - Validates jewelry requirements (gross weight & public price)
    ///  - Calculates Total Value = Unit Cost * Quantity On Hand
    ///  - Prevents saving when public price <= unit cost
    /// Register on: Update, Message = "Update", Primary Entity = "pdg_inventoryitem"
    /// Steps (suggested):
    ///   Pre-Operation: validate and compute values
    ///   Post-Operation: (optional) notify or fire follow-up logic
    /// </summary>
    public class ItemCostingPlugin : IPlugin
    {
        // Logical names aligned with your model & form scripts
        private const string EntityName = "pdg_inventoryitem";
        private const string AttrPublicPrice = "pdg_publicprice";
        private const string AttrUnitCost = "pdg_unitcost";
        private const string AttrTotalValue = "pdg_totalvalue";
        private const string AttrQtyOnHand = "pdg_quantityonhand";
        private const string AttrGrossWeight = "pdg_grossweight";
        private const string AttrItemType = "pdg_itemtype"; // OptionSet: jewelry assumed value present in your env

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var service = serviceFactory.CreateOrganizationService(context.UserId);
            var tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            if (!string.Equals(context.PrimaryEntityName, EntityName, StringComparison.OrdinalIgnoreCase))
                return;

            // Target on Update
            if (!(context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity target))
                return;

            // Merge Target + PreImage for reliable reads
            Entity pre = null;
            if (context.PreEntityImages.Contains("PreImage") && context.PreEntityImages["PreImage"] is Entity preImg)
                pre = preImg;

            // Helper to read decimal/money as decimal
            decimal GetDecimal(Entity e, string attr)
            {
                if (e == null) return 0m;
                if (e.Contains(attr) && e[attr] != null)
                {
                    var val = e[attr];
                    if (val is Money m) return m.Value;
                    if (val is decimal d) return d;
                    if (decimal.TryParse(val.ToString(), out var parsed)) return parsed;
                }
                return 0m;
            }

            // Compose working entity (prefer Target values, fall back to PreImage)
            decimal publicPrice = target.Contains(AttrPublicPrice) ? GetDecimal(target, AttrPublicPrice) : GetDecimal(pre, AttrPublicPrice);
            decimal unitCost    = target.Contains(AttrUnitCost)    ? GetDecimal(target, AttrUnitCost)    : GetDecimal(pre, AttrUnitCost);
            decimal qtyOnHand   = target.Contains(AttrQtyOnHand)   ? GetDecimal(target, AttrQtyOnHand)   : GetDecimal(pre, AttrQtyOnHand);
            decimal grossWeight = target.Contains(AttrGrossWeight) ? GetDecimal(target, AttrGrossWeight) : GetDecimal(pre, AttrGrossWeight);

            // === Jewelry-specific validation (mirrors your form JS) ===
            // If item type indicates jewelry (value depends on your option set), enforce required fields.
            // NOTE: Update the 'jewelryOptionValue' to match your environment if needed.
            int jewelryOptionValue = 100000001; // Same assumption as form script
            int? itemType = null;
            if ((target.Contains(AttrItemType) && target[AttrItemType] is OptionSetValue osv1))
                itemType = osv1.Value;
            else if ((pre != null) && pre.Contains(AttrItemType) && pre[AttrItemType] is OptionSetValue osv2)
                itemType = osv2.Value;

            if (itemType.HasValue && itemType.Value == jewelryOptionValue)
            {
                if (grossWeight <= 0)
                {
                    throw new InvalidPluginExecutionException("Gross weight is required for jewelry items.");
                }
                if (publicPrice <= 0)
                {
                    throw new InvalidPluginExecutionException("Public price is required for jewelry items.");
                }
            }

            // Prevent a negative pricing scenario
            if (publicPrice > 0 && unitCost > 0 && publicPrice <= unitCost)
            {
                throw new InvalidPluginExecutionException("Public price should be higher than unit cost.");
            }

            // Compute TotalValue = QtyOnHand * UnitCost (stored in money field)
            // Only set when at least one of the inputs changed
            bool qtyChanged = target.Contains(AttrQtyOnHand);
            bool costChanged = target.Contains(AttrUnitCost);

            if (qtyChanged || costChanged)
            {
                decimal totalValue = qtyOnHand * unitCost;
                var toUpdate = new Entity(EntityName) { Id = target.Id };
                toUpdate[AttrTotalValue] = new Money(totalValue);
                service.Update(toUpdate);
                tracing.Trace($"Total value updated to {totalValue} (Qty {qtyOnHand} * Cost {unitCost}).");
            }
        }
    }
}