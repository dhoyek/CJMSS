using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Inventory
{
    /// <summary>
    /// Plugin for <c>pdg_inventory</c> that handles per-lot overrides and rolls values back to
    /// the related <c>pdg_inventoryitem</c>.
    ///
    /// Baseline attributes like unit cost and public price live on <c>pdg_inventoryitem</c>.
    /// The inventory record only stores variations such as per-lot gross weight.
    /// When the lot weight changes this plugin recomputes the average gross weight
    /// across all lots and updates the item.
    ///
    /// Register on: Create & Update of <c>pdg_grossweight</c> for entity <c>pdg_inventory</c>.
    /// Pre Image suggestion: "PreImage" with <c>pdg_inventoryitem,pdg_grossweight</c>.
    /// </summary>
    public class InventoryRollupPlugin : IPlugin
    {
        private const string InventoryEntity = "pdg_inventory";
        private const string AttrLotWeight = "pdg_grossweight";
        // Lookup from inventory lot to the master item. In your data model this is "pdg_itemid".
        // Some environments may use "pdg_inventoryitem". We will resolve either at runtime.
        private const string AttrItemLookupPrimary = "pdg_itemid";       // preferred/observed in pdg_tables_report
        private const string AttrItemLookupAlternative = "pdg_inventoryitem"; // backward compatibility
        private const string ItemEntity = "pdg_inventoryitem";
        private const string ItemAttrGrossWeight = "pdg_grossweight"; // baseline gross weight

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var service = serviceFactory.CreateOrganizationService(context.UserId);
            var tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            if (!string.Equals(context.PrimaryEntityName, InventoryEntity, StringComparison.OrdinalIgnoreCase))
                return;

            if (!(context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity target))
                return;

            Entity? pre = null;
            if (context.PreEntityImages.Contains("PreImage") && context.PreEntityImages["PreImage"] is Entity preImg)
                pre = preImg;

            // Determine parent item
            EntityReference? itemRef = null; string itemLookupAttrUsed = AttrItemLookupPrimary;
            // Try primary name first
            if (target.Contains(AttrItemLookupPrimary) && target[AttrItemLookupPrimary] is EntityReference er1)
            { itemRef = er1; itemLookupAttrUsed = AttrItemLookupPrimary; }
            else if (pre != null && pre.Contains(AttrItemLookupPrimary) && pre[AttrItemLookupPrimary] is EntityReference er1b)
            { itemRef = er1b; itemLookupAttrUsed = AttrItemLookupPrimary; }
            // Fallback to alternative name
            else if (target.Contains(AttrItemLookupAlternative) && target[AttrItemLookupAlternative] is EntityReference er2)
            { itemRef = er2; itemLookupAttrUsed = AttrItemLookupAlternative; }
            else if (pre != null && pre.Contains(AttrItemLookupAlternative) && pre[AttrItemLookupAlternative] is EntityReference er2b)
            { itemRef = er2b; itemLookupAttrUsed = AttrItemLookupAlternative; }

            if (itemRef == null)
                return; // Cannot roll up without an item

            bool weightChanged = context.MessageName.Equals("Create", StringComparison.OrdinalIgnoreCase) ||
                                 target.Contains(AttrLotWeight);
            if (!weightChanged)
                return; // nothing to roll up

            // Retrieve all inventory lots for this item to calculate average weight
            var query = new QueryExpression(InventoryEntity)
            {
                ColumnSet = new ColumnSet(AttrLotWeight)
            };
            query.Criteria.AddCondition(itemLookupAttrUsed, ConditionOperator.Equal, itemRef.Id);

            var lots = service.RetrieveMultiple(query).Entities;
            decimal totalWeight = 0m;
            int count = 0;
            foreach (var lot in lots)
            {
                if (lot.Contains(AttrLotWeight) && lot[AttrLotWeight] != null)
                {
                    decimal w = 0m;
                    var val = lot[AttrLotWeight];
                    if (val is Money m) w = m.Value;
                    else if (val is decimal d) w = d;
                    else decimal.TryParse(val.ToString(), out w);
                    totalWeight += w;
                    count++;
                }
            }

            decimal avgWeight = count > 0 ? totalWeight / count : 0m;

            var itemUpdate = new Entity(ItemEntity) { Id = itemRef.Id };
            itemUpdate[ItemAttrGrossWeight] = avgWeight;
            service.Update(itemUpdate);

            tracing.Trace($"Rolled up average gross weight {avgWeight} to item {itemRef.Id} from {count} lots.");
        }
    }
}

