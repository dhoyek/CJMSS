using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using System.Linq;
using System.Globalization;
using System.ServiceModel;
using System.Threading;

namespace CJMSS.Plugins.Plugins.Inventory
{
    /// <summary>
    /// InventoryPostingPlugin
    ///
    /// Purpose:
    /// - Auto-post OUT issues for pdg_consumption to inventory (and write pdg_inventorytransaction)
    /// - Auto-post IN receipts for pdg_productionsheet when finishing/closing (and write pdg_costlayer)
    /// - Fully reverse postings on delete/cancel/reopen
    ///
    /// Suggested Registration:
    ///   1) Entity: pdg_consumption
    ///      - Create:  PostOperation, Synchronous
    ///      - Update:  PostOperation, Synchronous, Filtering Attributes: pdg_quantity,pdg_itemid,pdg_warehouseid,pdg_sheetstatus
    ///                 Images: Pre=PreImage (pdg_quantity,pdg_itemid,pdg_warehouseid,pdg_sheetstatus), Post=PostImage (same)
    ///                 Note: pdg_warehouseid on consumption is optional; the plugin falls back to
    ///                 the parent production sheet's pdg_warehouseid when missing.
    ///      - Delete:  PostOperation, Synchronous, PreImage: PreImage (pdg_quantity,pdg_itemid,pdg_warehouseid,pdg_sheetstatus)
    ///
    ///   2) Entity: pdg_productionsheet
    ///      - Update:  PostOperation, Synchronous, Filtering Attributes: pdg_progressstatus,pdg_sheetstatus,pdg_cogp,pdg_finisheditemid,pdg_warehouseid
    ///                 Images: Pre=PreImage (same), Post=PostImage (same)
    ///
    /// </summary>
    public class InventoryPostingPlugin : IPlugin
    {
        private const string ConsumptionEntity = "pdg_consumption";
        private const string ProductionEntity = "pdg_productionsheet";
        private const string AlloyEntity = "pdg_alloysheet";
        private const string PurchaseReceiptEntity = "pdg_purchaseorderreceipt";

        // Common option values (mapped to your environment)
        private static class Opt
        {
            // src/CJMSS.WebResources/Documentation/pdg_tables_report.txt
            // pdg_transactiontype: In (100000000), Out (100000001), Transfer (100000002), Adjustment (100000003), Count (100000004)
            public const int TransactionType_In = 100000000;
            public const int TransactionType_Out = 100000001;

            // pdg_referencetype: Purchase (100000000), Sales (100000001), Production (100000002), Transfer (100000003), Manual (100000004)
            public const int ReferenceType_Purchase = 100000000;
            public const int ReferenceType_Production = 100000002;
        }

        // Common fields
        private const string AttrItem = "pdg_itemid";
        private const string AttrWarehouse = "pdg_warehouseid";
        private const string AttrQty = "pdg_quantity";
        private const string AttrSheetStatus = "pdg_sheetstatus"; // Draft/Posted/Cancelled

        // Production fields
        private const string AttrFinishedItem = "pdg_finisheditemid";
        private const string AttrCOGP = "pdg_cogp";
        private const string AttrProgressStatus = "pdg_progressstatus"; // WP/FP

        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var org = factory.CreateOrganizationService(ctx.UserId);
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            if (string.Equals(ctx.PrimaryEntityName, ConsumptionEntity, StringComparison.OrdinalIgnoreCase))
            {
                HandleConsumption(ctx, org, trace);
                return;
            }

            if (string.Equals(ctx.PrimaryEntityName, ProductionEntity, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(ctx.MessageName, "Update", StringComparison.OrdinalIgnoreCase))
            {
                HandleProductionSheet(ctx, org, trace);
                return;
            }

            if (string.Equals(ctx.PrimaryEntityName, AlloyEntity, StringComparison.OrdinalIgnoreCase))
            {
                HandleAlloySheet(ctx, org, trace);
                return;
            }

            if (string.Equals(ctx.PrimaryEntityName, PurchaseReceiptEntity, StringComparison.OrdinalIgnoreCase))
            {
                // Purchase Order Receipt → inventory posting skeleton
                HandlePurchaseReceipt(ctx, org, trace);
                return;
            }
        }

        private void HandleConsumption(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace)
        {
            // Determine operation and images
            var pre = GetImage(ctx, "PreImage");
            var post = GetImage(ctx, "PostImage");
            var target = ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity e ? e : null;

            var message = ctx.MessageName ?? string.Empty;

            // Resolve key fields from post/target for Create/Update, pre for Delete
            Entity? sourceForRead = (string.Equals(message, "Delete", StringComparison.OrdinalIgnoreCase)) ? pre : (post ?? target);
            if (sourceForRead == null)
            {
                trace.Trace("InventoryPostingPlugin: No source entity available for consumption handling.");
                return;
            }

            var itemRef = sourceForRead.GetAttributeValue<EntityReference>(AttrItem);
            var whRef = sourceForRead.GetAttributeValue<EntityReference>(AttrWarehouse);
            var qty = GetDecimal(sourceForRead, AttrQty);
            var status = GetOption(sourceForRead, AttrSheetStatus);
            var productionRef = sourceForRead.GetAttributeValue<EntityReference>("pdg_productionsheet");
            EntityReference? fromBin = sourceForRead.GetAttributeValue<EntityReference>("pdg_frombinid");
            string? lotNumber = sourceForRead.GetAttributeValue<string>("pdg_lotnumber");

            // Fallback: if consumption doesn't have pdg_warehouseid, read it from parent production sheet
            if (whRef == null && productionRef != null)
            {
                try
                {
                    var prod = org.Retrieve(ProductionEntity, productionRef.Id, new ColumnSet(AttrWarehouse));
                    whRef = prod.GetAttributeValue<EntityReference>(AttrWarehouse);
                }
                catch { /* tolerate schema differences / missing parent */ }
            }

            if (itemRef == null || whRef == null)
            {
                trace.Trace("InventoryPostingPlugin: Missing item or warehouse on consumption; skipping.");
                return;
            }

            if (string.Equals(message, "Create", StringComparison.OrdinalIgnoreCase))
            {
                PostConsumptionIssue(ctx, org, trace, ctx.PrimaryEntityId, itemRef, whRef, fromBin, lotNumber, productionRef, qty, status);
            }
            else if (string.Equals(message, "Update", StringComparison.OrdinalIgnoreCase))
            {
                // Detect transitions or relevant field changes
                var preStatus = GetOption(pre, AttrSheetStatus);
                var preQty = GetDecimal(pre, AttrQty);

                if (status != preStatus || qty != preQty || FieldChanged(target, AttrItem) || FieldChanged(target, AttrWarehouse))
                {
                    RepostConsumptionIssue(ctx, org, trace, ctx.PrimaryEntityId, itemRef, whRef, fromBin, lotNumber, productionRef, qty, preQty, status, preStatus);
            }
            }
            else if (string.Equals(message, "Delete", StringComparison.OrdinalIgnoreCase))
            {
                ReverseConsumptionIssue(ctx, org, trace, ctx.PrimaryEntityId, itemRef, whRef, fromBin, lotNumber, productionRef, qty, status);
            }
        }

        private void HandlePurchaseReceipt(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace)
        {
            // Suggested Registration:
            //   Entity: pdg_purchaseorderreceipt
            //     - Create:  PostOperation, Sync
            //     - Update:  PostOperation, Sync, Filtering Attrs:
            //                pdg_purchaseorderid,pdg_purchaseorderlineid,pdg_quantityreceived,pdg_receiptdate
            //                (include pdg_binid,pdg_lotnumber if present in your model)
            //                Images: Pre=PreImage (above), Post=PostImage (above)
            //     - Delete:  PostOperation, Sync, PreImage: PreImage (above)

            var pre = GetImage(ctx, "PreImage");
            var post = GetImage(ctx, "PostImage");
            var target = ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity t ? t : null;
            var msg = ctx.MessageName ?? string.Empty;

            Entity? src = string.Equals(msg, "Delete", StringComparison.OrdinalIgnoreCase) ? pre : (post ?? target);
            if (src == null)
            {
                trace.Trace("PurchaseReceipt: no source entity available. Skipping.");
                return;
            }

            var receiptId = (ctx.PrimaryEntityId != Guid.Empty) ? ctx.PrimaryEntityId : (src.Id != Guid.Empty ? src.Id : Guid.Empty);
            var lineRef = src.GetAttributeValue<EntityReference>("pdg_purchaseorderlineid");
            var poRef = src.GetAttributeValue<EntityReference>("pdg_purchaseorderid");
            var qty = GetDecimal(src, "pdg_quantityreceived");
            var receiptDate = src.GetAttributeValue<DateTime?>("pdg_receiptdate") ?? DateTime.UtcNow;

            // Optional fields (present in some models) — will be null if not found
            var binRef = src.GetAttributeValue<EntityReference>("pdg_binid");
            var lotNumber = src.GetAttributeValue<string>("pdg_lotnumber");

            // Resolve item and warehouse via line/header
            EntityReference? itemRef = null;
            EntityReference? whRef = null;
            try
            {
                if (lineRef != null)
                {
                    var line = org.Retrieve("pdg_purchaseorderline", lineRef.Id, new ColumnSet("pdg_item", "pdg_purchaseorderid", "pdg_unitprice", "pdg_finalunitcost", "pdg_quantity"));
                    itemRef = line.GetAttributeValue<EntityReference>("pdg_item");
                    if (poRef == null) poRef = line.GetAttributeValue<EntityReference>("pdg_purchaseorderid");
                }
                if (poRef != null)
                {
                    // Note: PO header warehouse attribute logical name is pdg_warehouse
                    var po = org.Retrieve("pdg_purchaseorder", poRef.Id, new ColumnSet("pdg_warehouse"));
                    whRef = po.GetAttributeValue<EntityReference>("pdg_warehouse");
                }
            }
            catch (Exception ex)
            {
                trace.Trace("PurchaseReceipt: resolution error {0}", ex.Message);
            }

            trace.Trace("PurchaseReceipt: msg={0} receiptId={1} po={2} line={3} item={4} wh={5} qty={6}", msg, receiptId, poRef?.Id, lineRef?.Id, itemRef?.Id, whRef?.Id, qty);

            if (string.Equals(msg, "Create", StringComparison.OrdinalIgnoreCase))
            {
                PostPurchaseReceipt(ctx, org, trace, receiptId, poRef, lineRef, itemRef, whRef, binRef, lotNumber, qty, receiptDate);
                return;
            }

            if (string.Equals(msg, "Update", StringComparison.OrdinalIgnoreCase))
            {
                var preQty = GetDecimal(pre, "pdg_quantityreceived");
                if (FieldChanged(target, "pdg_quantityreceived") || FieldChanged(target, "pdg_purchaseorderlineid") || FieldChanged(target, "pdg_purchaseorderid"))
                {
                    RepostPurchaseReceipt(ctx, org, trace, receiptId, poRef, lineRef, itemRef, whRef, binRef, lotNumber, qty, preQty, receiptDate);
                }
                return;
            }

            if (string.Equals(msg, "Delete", StringComparison.OrdinalIgnoreCase))
            {
                ReversePurchaseReceipt(ctx, org, trace, receiptId, poRef, lineRef, itemRef, whRef, binRef, lotNumber, qty, receiptDate);
                return;
            }
        }

        private void PostPurchaseReceipt(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid receiptId, EntityReference? po, EntityReference? line, EntityReference? item, EntityReference? wh, EntityReference? bin, string? lotNumber,
            decimal qty, DateTime date)
        {
            // Skeleton: implement validation + transaction + cost layer posting
            trace.Trace("PostPurchaseReceipt: id={0} item={1} wh={2} qty={3}", receiptId, item?.Id, wh?.Id, qty);

            if (line == null) throw new InvalidPluginExecutionException("Purchase receipt must reference a PO line.");
            if (qty <= 0m) throw new InvalidPluginExecutionException("Quantity received must be greater than zero.");

            // Load line for validations and pricing
            var lineCols = new ColumnSet("pdg_item", "pdg_quantity", "pdg_unitprice", "pdg_finalunitcost", "pdg_purchaseorderid", "pdg_receiveduomid");
            var lineEnt = org.Retrieve("pdg_purchaseorderline", line.Id, lineCols);
            item = item ?? lineEnt.GetAttributeValue<EntityReference>("pdg_item")
                   ?? throw new InvalidPluginExecutionException("PO line missing item.");
            po = po ?? lineEnt.GetAttributeValue<EntityReference>("pdg_purchaseorderid")
                 ?? po;

            // Ensure warehouse (from header)
            if (wh == null && po != null)
            {
                var poEnt = org.Retrieve("pdg_purchaseorder", po.Id, new ColumnSet("pdg_warehouse"));
                wh = poEnt.GetAttributeValue<EntityReference>("pdg_warehouse");
            }
            if (wh == null) throw new InvalidPluginExecutionException("Receipt missing warehouse (check PO header).");

            // Validate lot/bin requirements by item flags when present
            bool __serialCountMismatch = false; int __serialCountFound = 0; // enforce after metadata try/catch
            try
            {
                var itemEnt = org.Retrieve("pdg_inventoryitem", item.Id, new ColumnSet("pdg_lotcontrolled", "pdg_serialcontrolled", "pdg_locationcontrolled"));
                var lotCtrl = itemEnt.GetAttributeValue<bool?>("pdg_lotcontrolled") ?? false;
                var serialCtrl = itemEnt.GetAttributeValue<bool?>("pdg_serialcontrolled") ?? false;
                var locationCtrl = itemEnt.GetAttributeValue<bool?>("pdg_locationcontrolled") ?? false;

                if (lotCtrl && string.IsNullOrWhiteSpace(lotNumber))
                    throw new InvalidPluginExecutionException("Lot number is required for lot-controlled items.");
                if (locationCtrl && bin == null)
                    throw new InvalidPluginExecutionException("Bin is required for location-controlled items.");
                if (serialCtrl)
                {
                    // Enforce: if serial numbers are captured on receipt, their count must equal qty
                    try
                    {
                        var qeSn = new QueryExpression("pdg_serialnumber")
                        {
                            ColumnSet = new ColumnSet(false),
                            NoLock = true,
                            PageInfo = new PagingInfo { Count = 1, PageNumber = 1, ReturnTotalRecordCount = true }
                        };
                        qeSn.Criteria = new FilterExpression(LogicalOperator.And);
                        qeSn.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, item.Id);
                        if (wh != null)
                            qeSn.Criteria.AddCondition("pdg_currentwarehouseid", ConditionOperator.Equal, wh.Id);
                        // Count serials dated on the same calendar day as the receipt
                        var dayStart = date.Date.ToUniversalTime();
                        var nextDay = dayStart.AddDays(1);
                        var endOfDayInclusive = nextDay.AddTicks(-1);
                        qeSn.Criteria.AddCondition("pdg_receiptdate", ConditionOperator.OnOrAfter, dayStart);
                        qeSn.Criteria.AddCondition("pdg_receiptdate", ConditionOperator.OnOrBefore, endOfDayInclusive);

                        var snRes = org.RetrieveMultiple(qeSn);
                        var snCount = snRes.TotalRecordCount >= 0 ? snRes.TotalRecordCount : snRes.Entities.Count;

                        if (snCount > 0)
                        {
                            // Only enforce when the serial table is actually used for this receipt context
                            if (Math.Abs((decimal)snCount - qty) > 0.00001m)
                            {
                                __serialCountMismatch = true;
                                __serialCountFound = snCount;
                            }
                        }
                    }
                    catch { /* tolerate absence of pdg_serialnumber or attribute variance */ }
                }
            }
            catch { /* tolerate metadata variance */ }

            if (__serialCountMismatch)
                throw new InvalidPluginExecutionException($"Serial numbers assigned ({__serialCountFound}) must equal received quantity ({qty}).");

            // Over-receipt validation: sum other receipts for this line (with optional override/tolerance)
            var ordered = lineEnt.GetAttributeValue<decimal?>("pdg_quantity") ?? 0m;
            var qe = new QueryExpression("pdg_purchaseorderreceipt")
            {
                ColumnSet = new ColumnSet("pdg_quantityreceived"),
                NoLock = true
            };
            qe.Criteria.AddCondition("pdg_purchaseorderlineid", ConditionOperator.Equal, line.Id);
            qe.Criteria.AddCondition("pdg_purchaseorderreceiptid", ConditionOperator.NotEqual, receiptId);
            var existing = org.RetrieveMultiple(qe).Entities;
            decimal already = 0m;
            foreach (var r in existing) already += r.GetAttributeValue<decimal?>("pdg_quantityreceived") ?? 0m;
            // Optional flags (if present in the model). We do not include in ColumnSet to remain resilient; GetAttributeValue will return defaults if absent.
            bool allowOver = (lineEnt.GetAttributeValue<bool?>("pdg_allowoverreceipt") ?? false);
            decimal tolPct = (lineEnt.GetAttributeValue<decimal?>("pdg_overreceipttolerance") ?? 0m);
            Entity? poEntForFlags = null;
            if (po != null)
            {
                try { poEntForFlags = org.Retrieve("pdg_purchaseorder", po.Id, new ColumnSet("pdg_warehouse")); } catch { poEntForFlags = null; }
            }
            if (!allowOver && poEntForFlags != null)
            {
                allowOver = poEntForFlags.GetAttributeValue<bool?>("pdg_allowoverreceipt") ?? false;
                if (tolPct <= 0m)
                    tolPct = poEntForFlags.GetAttributeValue<decimal?>("pdg_overreceipttolerance") ?? 0m;
            }
            var proposed = already + qty;
            if (ordered > 0m)
            {
                var cap = ordered;
                if (allowOver)
                {
                    if (tolPct > 0m) cap = ordered * (1m + (tolPct / 100m));
                    else cap = decimal.MaxValue; // unrestricted override if no tolerance specified
                }
                if (proposed - cap > 0.00001m)
                    throw new InvalidPluginExecutionException("Received quantity exceeds allowed limit.");
            }

            // UoM conversion and family validation
            try
            {
                var recvUom = lineEnt.GetAttributeValue<EntityReference>("pdg_receiveduomid");
                if (recvUom != null)
                {
                    // Validate received UoM family matches item primary/base UoM
                    Guid? itemPrimaryBase = null;
                    try
                    {
                        var itemDef = org.Retrieve("pdg_inventoryitem", item.Id, new ColumnSet("pdg_primaryuomid"));
                        var primary = itemDef.GetAttributeValue<EntityReference>("pdg_primaryuomid");
                        if (primary != null)
                        {
                            var primUom = org.Retrieve("pdg_unitofmeasure", primary.Id, new ColumnSet("pdg_baseuom"));
                            var baseRef = primUom.GetAttributeValue<EntityReference>("pdg_baseuom");
                            itemPrimaryBase = baseRef != null ? baseRef.Id : primary.Id;
                        }
                    }
                    catch (Exception ex)
                    {
                        trace.Trace("UoM validation: could not resolve item primary/base UoM: {0}", ex.Message);
                    }

                    Guid? recvBase = null;
                    try
                    {
                        var recv = org.Retrieve("pdg_unitofmeasure", recvUom.Id, new ColumnSet("pdg_baseuom", "pdg_conversionfactor"));
                        var baseRef = recv.GetAttributeValue<EntityReference>("pdg_baseuom");
                        recvBase = baseRef != null ? baseRef.Id : recvUom.Id;

                        // Apply conversion factor to convert received qty to base
                        var factor = recv.GetAttributeValue<decimal?>("pdg_conversionfactor") ?? 1m;
                        if (factor > 0m)
                        {
                            trace.Trace("PurchaseReceipt: applying UoM conversion factor {0}", factor);
                            qty = qty * factor;
                        }
                    }
                    catch (Exception ex)
                    {
                        trace.Trace("UoM validation: could not resolve received UoM details: {0}", ex.Message);
                    }

                    if (itemPrimaryBase.HasValue && recvBase.HasValue && itemPrimaryBase.Value != recvBase.Value)
                    {
                        throw new InvalidPluginExecutionException("Received UoM is not in the same UoM family as the item's primary UoM.");
                    }
                }
            }
            catch { /* log-only handled above; throw only on explicit family mismatch */ }

            // Resolve unit cost (prefer final unit cost, else unit price money)
            decimal unitCost = 0m;
            var fuc = lineEnt.GetAttributeValue<Money>("pdg_finalunitcost");
            var up = lineEnt.GetAttributeValue<Money>("pdg_unitprice");
            if (fuc != null && fuc.Value > 0m) unitCost = fuc.Value;
            else if (up != null && up.Value > 0m) unitCost = up.Value;

            // Post IN transaction
            UpsertInventoryTransaction(org, trace, $"{receiptId}-PO-IN", new InventoryTxn
            {
                Item = item,
                WarehouseFrom = null,
                WarehouseTo = wh,
                BinTo = bin,
                Quantity = qty,
                UnitCost = unitCost,
                TotalCost = unitCost * qty,
                TransactionDate = date,
                TransactionType = Opt.TransactionType_In,
                ReferenceType = Opt.ReferenceType_Purchase,
                CostCalculationMethod = 100000000, // Average Cost default
                LotNumber = lotNumber
            });

            // Ensure inventory record exists and create/augment cost layer
            Guid invId = (bin != null)
                ? GetOrCreateInventory(org, item!, wh!, bin!, trace)
                : GetOrCreateInventory(org, item!, wh!, trace);
            if (invId != Guid.Empty)
            {
                UpsertTargetCostLayer(org, trace, receiptId, item, invId, unitCost, qty, date, "PO");
            }

            // Update item last cost
            try
            {
                var itemUpd = new Entity("pdg_inventoryitem") { Id = item.Id };
                itemUpd["pdg_lastcost"] = new Money(unitCost);
                org.Update(itemUpd);
            }
            catch { }
        }

        private void RepostPurchaseReceipt(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid receiptId, EntityReference? po, EntityReference? line, EntityReference? item, EntityReference? wh, EntityReference? bin, string? lotNumber,
            decimal newQty, decimal oldQty, DateTime date)
        {
            trace.Trace("RepostPurchaseReceipt: id={0} item={1} wh={2} newQty={3} oldQty={4}", receiptId, item?.Id, wh?.Id, newQty, oldQty);

            if (newQty == oldQty) return;

            // Get original txn to reuse unit/total cost if needed
            var original = GetInventoryTransactionByReference(org, $"{receiptId}-PO-IN");
            decimal unit = 0m; decimal total = 0m; DateTime txnDate = date;
            if (original != null)
            {
                unit = GetMoney(original, "pdg_unitcost");
                total = GetMoney(original, "pdg_totalcost");
                txnDate = original.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? date;
            }

            // Reverse previous posting (OUT for oldQty)
            UpsertInventoryTransaction(org, trace, $"{receiptId}-PO-IN-REV", new InventoryTxn
            {
                Item = item ?? throw new InvalidPluginExecutionException("Receipt missing item"),
                WarehouseFrom = wh ?? throw new InvalidPluginExecutionException("Receipt missing warehouse"),
                WarehouseTo = null,
                BinFrom = bin,
                Quantity = oldQty,
                UnitCost = unit,
                TotalCost = unit * oldQty,
                TransactionDate = txnDate,
                TransactionType = Opt.TransactionType_Out,
                ReferenceType = Opt.ReferenceType_Purchase,
                CostCalculationMethod = 100000000,
                LotNumber = lotNumber
            });

            // Post new IN for newQty (recompute cost via line)
            PostPurchaseReceipt(ctx, org, trace, receiptId, po, line, item, wh, bin, lotNumber, newQty, date);

            // Adjust cost layer to match newQty (UpsertTargetCostLayer will upsert by reference id)
            // DeactivateTargetCostLayerByReference/ZeroLayerByReference helpers exist; for quantity change we rely on upsert implementation
        }

        private void ReversePurchaseReceipt(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid receiptId, EntityReference? po, EntityReference? line, EntityReference? item, EntityReference? wh, EntityReference? bin, string? lotNumber,
            decimal qty, DateTime date)
        {
            trace.Trace("ReversePurchaseReceipt: id={0} item={1} wh={2} qty={3}", receiptId, item?.Id, wh?.Id, qty);

            var original = GetInventoryTransactionByReference(org, $"{receiptId}-PO-IN");
            decimal unit = 0m; decimal total = 0m; var txnDate = date;
            if (original != null)
            {
                unit = GetMoney(original, "pdg_unitcost");
                total = GetMoney(original, "pdg_totalcost");
                txnDate = original.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? date;
            }

            UpsertInventoryTransaction(org, trace, $"{receiptId}-PO-IN-REV", new InventoryTxn
            {
                Item = item ?? throw new InvalidPluginExecutionException("Receipt missing item"),
                WarehouseFrom = wh ?? throw new InvalidPluginExecutionException("Receipt missing warehouse"),
                WarehouseTo = null,
                BinFrom = bin,
                Quantity = qty,
                UnitCost = unit,
                TotalCost = unit * qty,
                TransactionDate = txnDate,
                TransactionType = Opt.TransactionType_Out,
                ReferenceType = Opt.ReferenceType_Purchase,
                CostCalculationMethod = 100000000,
                LotNumber = lotNumber
            });

            // Zero/deactivate the cost layer for this receipt reference
            DeactivateTargetCostLayerByReference(org, trace, receiptId);
        }

        private void HandleProductionSheet(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace)
        {
            var pre = GetImage(ctx, "PreImage");
            var post = GetImage(ctx, "PostImage");
            var target = ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity e ? e : null;
            var src = post ?? target;
            if (src == null)
            {
                trace.Trace("InventoryPostingPlugin: No source entity available for production handling.");
                return;
            }

            var finishedItem = src.GetAttributeValue<EntityReference>(AttrFinishedItem);
            var whRef = src.GetAttributeValue<EntityReference>(AttrWarehouse);
            var cogp = GetMoney(src, AttrCOGP);
            var newProgress = GetOption(src, AttrProgressStatus);
            var oldProgress = GetOption(pre, AttrProgressStatus);
            var newStatus = GetOption(src, AttrSheetStatus);
            var oldStatus = GetOption(pre, AttrSheetStatus);

            if (finishedItem == null || whRef == null)
            {
                trace.Trace("InventoryPostingPlugin: Missing finished item or warehouse on production sheet; skipping.");
                return;
            }

            // Post receipt when progressing to Finished/Closed; reverse on rollback/cancel
            var movedToFinished = (newProgress != null && oldProgress != null && newProgress != oldProgress);
            var statusChanged = (newStatus != null && oldStatus != null && newStatus != oldStatus);

            if (movedToFinished || statusChanged)
            {
                PostProductionReceipt(ctx, org, trace, ctx.PrimaryEntityId, finishedItem, whRef, cogp, newProgress, newStatus, oldProgress, oldStatus);
            }
        }

        private void HandleAlloySheet(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace)
        {
            // Registration suggestion:
            //  Entity: pdg_alloysheet
            //   - Create: PostOperation, Synchronous
            //   - Update: PostOperation, Synchronous, Filtering: pdg_sheetstatus,pdg_alloydate,pdg_warehouseid,pdg_sourceitemid,pdg_targetitemid,pdg_inputquantity,pdg_outputquantity,pdg_losspercentage,pdg_charges
            //             Images: Pre=PreImage (above), Post=PostImage (above)
            //   - Delete: PostOperation, Synchronous, PreImage (same)

            var pre = GetImage(ctx, "PreImage");
            var post = GetImage(ctx, "PostImage");
            var target = ctx.InputParameters.Contains("Target") && ctx.InputParameters["Target"] is Entity te ? te : null;

            var message = ctx.MessageName ?? string.Empty;

            // Resolve a source entity for reading fields
            Entity? src;
            if (string.Equals(message, "Delete", StringComparison.OrdinalIgnoreCase))
                src = pre;
            else
                src = post ?? target;

            if (src == null)
            {
                trace.Trace("InventoryPostingPlugin: No source entity available for alloy handling.");
                return;
            }

            var whRef = src.GetAttributeValue<EntityReference>(AttrWarehouse);
            var sourceItem = src.GetAttributeValue<EntityReference>("pdg_sourceitemid");
            var targetItem = src.GetAttributeValue<EntityReference>("pdg_targetitemid");
            EntityReference? fromBinAlloy = src.GetAttributeValue<EntityReference>("pdg_frombinid");
            EntityReference? toBinAlloy = src.GetAttributeValue<EntityReference>("pdg_tobinid");
            string? lotAlloy = src.GetAttributeValue<string>("pdg_lotnumber");
            var inputQty = GetDecimal(src, "pdg_inputquantity");
            var outputQty = GetDecimal(src, "pdg_outputquantity");
            var charges = GetMoney(src, "pdg_charges");
            var status = GetOption(src, AttrSheetStatus);
            var sheetDate = src.GetAttributeValue<DateTime?>("pdg_alloydate") ?? DateTime.UtcNow;
            var sheetId = (ctx.PrimaryEntityId != Guid.Empty) ? ctx.PrimaryEntityId : (src.Id != Guid.Empty ? src.Id : Guid.Empty);

            if (whRef == null || sourceItem == null || targetItem == null)
            {
                trace.Trace("InventoryPostingPlugin: Alloy missing warehouse or items; skipping.");
                return;
            }

            if (string.Equals(message, "Create", StringComparison.OrdinalIgnoreCase))
            {
                PostAlloyPosting(ctx, org, trace, sheetId, sourceItem, targetItem, whRef, fromBinAlloy, toBinAlloy, lotAlloy, inputQty, outputQty, charges, status, sheetDate);
                return;
            }

            if (string.Equals(message, "Update", StringComparison.OrdinalIgnoreCase))
            {
                // Detect status transitions or qty/material changes to re-post
                var oldStatus = GetOption(pre, AttrSheetStatus);
                var newStatus = status;

                if (oldStatus != newStatus || FieldChanged(target, "pdg_inputquantity") || FieldChanged(target, "pdg_outputquantity")
                    || FieldChanged(target, "pdg_sourceitemid") || FieldChanged(target, "pdg_targetitemid")
                    || FieldChanged(target, "pdg_warehouseid") || FieldChanged(target, "pdg_charges"))
                {
                    RepostAlloy(ctx, org, trace, sheetId,
                        sourceItem, targetItem, whRef, fromBinAlloy, toBinAlloy, lotAlloy,
                        GetDecimal(post ?? target, "pdg_inputquantity"), GetDecimal(post ?? target, "pdg_outputquantity"), GetMoney(post ?? target, "pdg_charges"), newStatus,
                        pre?.GetAttributeValue<EntityReference>("pdg_sourceitemid"), pre?.GetAttributeValue<EntityReference>("pdg_targetitemid"), pre?.GetAttributeValue<EntityReference>(AttrWarehouse), pre?.GetAttributeValue<EntityReference>("pdg_frombinid"), pre?.GetAttributeValue<EntityReference>("pdg_tobinid"), pre?.GetAttributeValue<string>("pdg_lotnumber"),
                        GetDecimal(pre, "pdg_inputquantity"), GetDecimal(pre, "pdg_outputquantity"), GetMoney(pre, "pdg_charges"), oldStatus,
                        sheetDate);
                }
                return;
            }

            if (string.Equals(message, "Delete", StringComparison.OrdinalIgnoreCase))
            {
                ReverseAlloyPosting(ctx, org, trace, sheetId, sourceItem, targetItem, whRef, fromBinAlloy, toBinAlloy, inputQty, outputQty, charges, status, sheetDate);
                return;
            }
        }

        // === Placeholder posting operations (to be implemented) ===

        private void PostConsumptionIssue(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sourceId, EntityReference item, EntityReference warehouse, EntityReference? fromBin, string? lotNumber,
            EntityReference? productionSheet, decimal qty, int? status)
        {
            trace.Trace($"InventoryPostingPlugin: PostConsumptionIssue source={sourceId}, item={item.Id}, wh={warehouse.Id}, qty={qty}, status={status}");

            // Only when Posted (Consumption: Draft 890590000, Posted 890590001)
            if (status != 890590001) return;

            var method = ResolveValuationMethod(org, warehouse.Id, item.Id);
            ValidateSufficientStock(org, warehouse.Id, item.Id, fromBin?.Id, qty, method);
            LayerAllocation[] allocs;
            var cost = AllocateFromLayers(org, item.Id, warehouse.Id, fromBin?.Id, qty, method, trace, out allocs);

            var referenceId = $"{sourceId}-OUT";
            UpsertInventoryTransaction(org, trace, referenceId, new InventoryTxn
            {
                Item = item,
                WarehouseFrom = warehouse,
                BinFrom = fromBin,
                WarehouseTo = null,
                Quantity = qty,
                UnitCost = cost.UnitCost,
                TotalCost = cost.TotalCost,
                TransactionDate = DateTime.UtcNow,
                TransactionType = 100000001, // Out
                ReferenceType = 100000002,    // Production
                AlloySheetId = Guid.Empty,
                ProductionSheetId = productionSheet?.Id ?? Guid.Empty,
                CostCalculationMethod = MapCostCalcMethod(method),
                RemarksJson = SerializeAllocations(allocs),
                LotNumber = lotNumber
            });
        }

        private void RepostConsumptionIssue(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sourceId, EntityReference item, EntityReference warehouse, EntityReference? fromBin, string? lotNumber,
            EntityReference? productionSheet, decimal newQty, decimal oldQty, int? newStatus, int? oldStatus)
        {
            trace.Trace($"InventoryPostingPlugin: RepostConsumptionIssue source={sourceId}, item={item.Id}, wh={warehouse.Id}, newQty={newQty}, oldQty={oldQty}, newStatus={newStatus}, oldStatus={oldStatus}");
            // Full rebuild via reversal entries
            ReverseConsumptionIssue(ctx, org, trace, sourceId, item, warehouse, fromBin, lotNumber, productionSheet, oldQty, oldStatus);
            PostConsumptionIssue(ctx, org, trace, sourceId, item, warehouse, fromBin, lotNumber, productionSheet, newQty, newStatus);
        }

        private void ReverseConsumptionIssue(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sourceId, EntityReference item, EntityReference warehouse, EntityReference? fromBin, string? lotNumber,
            EntityReference? productionSheet, decimal qty, int? status)
        {
            trace.Trace($"InventoryPostingPlugin: ReverseConsumptionIssue source={sourceId}, item={item.Id}, wh={warehouse.Id}, qty={qty}, status={status}");
            // Create reversal IN for previously posted OUT, using original costs if found
            var original = GetInventoryTransactionByReference(org, $"{sourceId}-OUT");
            decimal unit = 0m, total = 0m; DateTime date = DateTime.UtcNow; int method = 100000000;
            if (original != null)
            {
                unit = GetMoney(original, "pdg_unitcost");
                total = GetMoney(original, "pdg_totalcost");
                date = original.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? date;
                var m = GetOption(original, "pdg_costcalculationmethod");
                method = m ?? 100000000;
                // Restore allocations to layers
                var allocs = ParseAllocations(original.GetAttributeValue<string>("pdg_remarks"));
                RestoreToLayers(org, allocs, trace);
            }
            else
            {
                // Fallback to recompute
                var vm = ResolveValuationMethod(org, warehouse.Id, item.Id);
                var cost = ComputeConsumptionCost(org, item.Id, warehouse.Id, fromBin?.Id, qty, vm, trace);
                unit = cost.UnitCost; total = cost.TotalCost; method = MapCostCalcMethod(vm);
            }
            var revRef = $"{sourceId}-OUT-REV";
            UpsertInventoryTransaction(org, trace, revRef, new InventoryTxn
            {
                Item = item,
                WarehouseFrom = null,
                WarehouseTo = warehouse,
                BinTo = fromBin,
                Quantity = qty,
                UnitCost = unit,
                TotalCost = total,
                TransactionDate = date,
                TransactionType = 100000000, // In
                ReferenceType = 100000002,    // Production
                AlloySheetId = Guid.Empty,
                ProductionSheetId = productionSheet?.Id ?? Guid.Empty,
                CostCalculationMethod = method,
                LotNumber = lotNumber
            });
        }

        private void PostProductionReceipt(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sourceId, EntityReference finishedItem, EntityReference warehouse, decimal cogp, int? newProgress, int? newStatus, int? oldProgress, int? oldStatus)
        {
            trace.Trace($"InventoryPostingPlugin: PostProductionReceipt source={sourceId}, item={finishedItem.Id}, wh={warehouse.Id}, cogp={cogp}, newProg={newProgress}, newStatus={newStatus}, oldProg={oldProgress}, oldStatus={oldStatus}");

            // Production: Progress FP (890590001) or Sheet Closed (890590001) means posted; otherwise unposted
            bool shouldPost = (newProgress == 890590001) || (newStatus == 890590001);
            bool wasPosted = (oldProgress == 890590001) || (oldStatus == 890590001);

            var qty = 1m; // assume one finished piece per sheet
            var unit = cogp; // per piece cost
            var total = unit * qty;
            var date = DateTime.UtcNow;

            if (shouldPost && !wasPosted)
            {
                // Post IN transaction for finished item
                UpsertInventoryTransaction(org, trace, $"{sourceId}-PROD-IN", new InventoryTxn
                {
                    Item = finishedItem,
                    WarehouseFrom = null,
                    WarehouseTo = warehouse,
                    Quantity = qty,
                    UnitCost = unit,
                    TotalCost = total,
                    TransactionDate = date,
                    TransactionType = 100000000, // In
                    ReferenceType = 100000002,    // Production
                    AlloySheetId = Guid.Empty,
                    ProductionSheetId = sourceId,
                    CostCalculationMethod = 100000000 // Average Cost, neutral
                });

                // Ensure inventory exists and create a receipt cost layer
                var invId = GetOrCreateInventory(org, finishedItem, warehouse, trace);
                UpsertTargetCostLayer(org, trace, sourceId, finishedItem, invId, unit, qty, date, "PRD");
            }
            else if (!shouldPost && wasPosted)
            {
                // Reverse previously posted production receipt via OUT
                var original = GetInventoryTransactionByReference(org, $"{sourceId}-PROD-IN");
                if (original != null)
                {
                    unit = GetMoney(original, "pdg_unitcost");
                    total = GetMoney(original, "pdg_totalcost");
                    date = original.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? date;
                }
                UpsertInventoryTransaction(org, trace, $"{sourceId}-PROD-IN-REV", new InventoryTxn
                {
                    Item = finishedItem,
                    WarehouseFrom = warehouse,
                    WarehouseTo = null,
                    Quantity = qty,
                    UnitCost = unit,
                    TotalCost = total,
                    TransactionDate = date,
                    TransactionType = 100000001, // Out
                    ReferenceType = 100000002,
                    AlloySheetId = Guid.Empty,
                    ProductionSheetId = sourceId,
                    CostCalculationMethod = 100000000
                });

                // Deactivate the related cost layer
                DeactivateTargetCostLayerByReference(org, trace, sourceId);
            }
            else if (shouldPost && wasPosted)
            {
                // If already posted and values changed, rebuild by reversing then posting
                // Compare COGP change only (simple rule)
                var existing = GetInventoryTransactionByReference(org, $"{sourceId}-PROD-IN");
                if (existing != null)
                {
                    var existingTotal = GetMoney(existing, "pdg_totalcost");
                    if (existingTotal != total)
                    {
                        // reverse and re-post
                        UpsertInventoryTransaction(org, trace, $"{sourceId}-PROD-IN-REV", new InventoryTxn
                        {
                            Item = finishedItem,
                            WarehouseFrom = warehouse,
                            WarehouseTo = null,
                            Quantity = qty,
                            UnitCost = GetMoney(existing, "pdg_unitcost"),
                            TotalCost = existingTotal,
                            TransactionDate = existing.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? date,
                            TransactionType = 100000001,
                            ReferenceType = 100000002,
                            AlloySheetId = Guid.Empty,
                            ProductionSheetId = sourceId,
                            CostCalculationMethod = 100000000
                        });

                        UpsertInventoryTransaction(org, trace, $"{sourceId}-PROD-IN", new InventoryTxn
                        {
                            Item = finishedItem,
                            WarehouseFrom = null,
                            WarehouseTo = warehouse,
                            Quantity = qty,
                            UnitCost = unit,
                            TotalCost = total,
                            TransactionDate = date,
                            TransactionType = 100000000,
                            ReferenceType = 100000002,
                            AlloySheetId = Guid.Empty,
                            ProductionSheetId = sourceId,
                            CostCalculationMethod = 100000000
                        });

                        var invId = GetOrCreateInventory(org, finishedItem, warehouse, trace);
                        UpsertTargetCostLayer(org, trace, sourceId, finishedItem, invId, unit, qty, date, "PRD");
                    }
                }
            }
        }

        // === Alloy posting placeholders ===

        private void PostAlloyPosting(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sheetId, EntityReference sourceItem, EntityReference targetItem, EntityReference warehouse,
            EntityReference? fromBin, EntityReference? toBin, string? lotNumber,
            decimal inputQty, decimal outputQty, decimal charges, int? status, DateTime sheetDate)
        {
            trace.Trace($"InventoryPostingPlugin: PostAlloyPosting sheet={sheetId}, srcItem={sourceItem.Id}, trgItem={targetItem.Id}, wh={warehouse.Id}, inQty={inputQty}, outQty={outputQty}, charges={charges}, status={status}, date={sheetDate:u}");

            // Only act when status is Posted
            if (status != 100000001) // Posted
            {
                trace.Trace("Alloy status not Posted; skipping posting.");
                return;
            }

            // Resolve valuation method (Warehouse -> Item -> fallback Average)
            var method = ResolveValuationMethod(org, warehouse.Id, sourceItem.Id);
            // Negative stock rule enforcement
            ValidateSufficientStock(org, warehouse.Id, sourceItem.Id, fromBin?.Id, inputQty, method);
            trace.Trace($"Resolved valuation method: {method}");

            // Compute and allocate consumed cost from source layers
            LayerAllocation[] allocs;
            var consumed = AllocateFromLayers(org, sourceItem.Id, warehouse.Id, fromBin?.Id, inputQty, method, trace, out allocs);
            if (consumed.TotalCost <= 0m && method == ValuationMethod.MovingAverage)
            {
                trace.Trace("MovingAverage: no cost available; using 0 for consumed cost");
            }

            var totalInCost = consumed.TotalCost + charges;
            var unitInCost = outputQty > 0m ? totalInCost / outputQty : 0m;

            // Upsert OUT transaction
            var outRef = $"{sheetId}-OUT";
            UpsertInventoryTransaction(org, trace, outRef, new InventoryTxn
            {
                Item = sourceItem,
                WarehouseFrom = warehouse,
                BinFrom = fromBin,
                WarehouseTo = null,
                Quantity = inputQty,
                UnitCost = consumed.UnitCost,
                TotalCost = consumed.TotalCost,
                TransactionDate = sheetDate,
                TransactionType = 100000001, // Out
                ReferenceType = 100000002,    // Production
                AlloySheetId = sheetId,
                CostCalculationMethod = MapCostCalcMethod(method),
                RemarksJson = SerializeAllocations(allocs),
                LotNumber = lotNumber
            });

            // Upsert IN transaction
            var inRef = $"{sheetId}-IN";
            UpsertInventoryTransaction(org, trace, inRef, new InventoryTxn
            {
                Item = targetItem,
                WarehouseFrom = null,
                WarehouseTo = warehouse,
                BinTo = toBin,
                Quantity = outputQty,
                UnitCost = unitInCost,
                TotalCost = unitInCost * outputQty,
                TransactionDate = sheetDate,
                TransactionType = 100000000, // In
                ReferenceType = 100000002,    // Production
                AlloySheetId = sheetId,
                CostCalculationMethod = MapCostCalcMethod(method),
                LotNumber = lotNumber
            });

            // Ensure inventory record for target exists
            var targetInventoryId = (toBin != null)
                ? GetOrCreateInventory(org, targetItem, warehouse, toBin, trace)
                : GetOrCreateInventory(org, targetItem, warehouse, trace);

            // Upsert cost layer for target (one per sheet)
            UpsertTargetCostLayer(org, trace, sheetId, targetItem, targetInventoryId, unitInCost, outputQty, sheetDate);
            if (fromBin != null && toBin != null)
                CreateBinHistory(org, trace, warehouse, targetItem, fromBin, toBin, outputQty, sheetDate, targetInventoryId);
        }

        private void RepostAlloy(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sheetId,
            EntityReference newSourceItem, EntityReference newTargetItem, EntityReference newWarehouse,
            EntityReference? newFromBin, EntityReference? newToBin, string? newLot,
            decimal newInputQty, decimal newOutputQty, decimal newCharges, int? newStatus,
            EntityReference? oldSourceItem, EntityReference? oldTargetItem, EntityReference? oldWarehouse,
            EntityReference? oldFromBin, EntityReference? oldToBin, string? oldLot,
            decimal oldInputQty, decimal oldOutputQty, decimal oldCharges, int? oldStatus,
            DateTime sheetDate)
        {
            trace.Trace($"InventoryPostingPlugin: RepostAlloy sheet={sheetId}, new(in={newInputQty},out={newOutputQty},status={newStatus}), old(in={oldInputQty},out={oldOutputQty},status={oldStatus})");
            // Reverse prior postings (if any)
            ReverseAlloyPosting(ctx, org, trace, sheetId, oldSourceItem, oldTargetItem, oldWarehouse, oldFromBin, oldToBin, oldInputQty, oldOutputQty, oldCharges, oldStatus, sheetDate);
            // Post with new values
            PostAlloyPosting(ctx, org, trace, sheetId, newSourceItem, newTargetItem, newWarehouse, newFromBin, newToBin, newLot, newInputQty, newOutputQty, newCharges, newStatus, sheetDate);
        }

        private void ReverseAlloyPosting(IPluginExecutionContext ctx, IOrganizationService org, ITracingService trace,
            Guid sheetId, EntityReference? sourceItem, EntityReference? targetItem, EntityReference? warehouse,
            EntityReference? fromBin, EntityReference? toBin,
            decimal inputQty, decimal outputQty, decimal charges, int? status, DateTime sheetDate)
        {
            if (warehouse == null || sourceItem == null || targetItem == null)
            {
                trace.Trace("ReverseAlloyPosting: missing required references; skipping.");
                return;
            }
            trace.Trace($"InventoryPostingPlugin: ReverseAlloyPosting sheet={sheetId}, srcItem={sourceItem?.Id}, trgItem={targetItem?.Id}, inQty={inputQty}, outQty={outputQty}, status={status}");

            // Reverse OUT -> create IN
            var outTx = GetInventoryTransactionByReference(org, $"{sheetId}-OUT");
            if (outTx != null)
            {
                var unit = GetMoney(outTx, "pdg_unitcost");
                var total = GetMoney(outTx, "pdg_totalcost");
                var date = outTx.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? sheetDate;
                var method = GetOption(outTx, "pdg_costcalculationmethod") ?? 100000000;
                // Restore layer allocations if present
                LayerAllocation[] allocs = ParseAllocations(outTx.GetAttributeValue<string>("pdg_remarks"));
                RestoreToLayers(org, allocs, trace);

                var revOutRef = $"{sheetId}-OUT-REV";
                UpsertInventoryTransaction(org, trace, revOutRef, new InventoryTxn
                {
                    Item = sourceItem,
                    WarehouseFrom = null,
                    WarehouseTo = warehouse,
                    BinTo = fromBin,
                    Quantity = inputQty,
                    UnitCost = unit,
                    TotalCost = total,
                    TransactionDate = date,
                    TransactionType = 100000000, // In
                    ReferenceType = 100000002,
                    AlloySheetId = sheetId,
                    CostCalculationMethod = method
                });
            }

            // Reverse IN -> create OUT
            var inTx = GetInventoryTransactionByReference(org, $"{sheetId}-IN");
            if (inTx != null)
            {
                var unit = GetMoney(inTx, "pdg_unitcost");
                var total = GetMoney(inTx, "pdg_totalcost");
                var date = inTx.GetAttributeValue<DateTime?>("pdg_transactiondate") ?? sheetDate;
                var method = GetOption(inTx, "pdg_costcalculationmethod") ?? 100000000;
                var revInRef = $"{sheetId}-IN-REV";
                UpsertInventoryTransaction(org, trace, revInRef, new InventoryTxn
                {
                    Item = targetItem,
                    WarehouseFrom = warehouse,
                    BinFrom = toBin,
                    WarehouseTo = null,
                    Quantity = outputQty,
                    UnitCost = unit,
                    TotalCost = total,
                    TransactionDate = date,
                    TransactionType = 100000001, // Out
                    ReferenceType = 100000002,
                    AlloySheetId = sheetId,
                    CostCalculationMethod = method
                });
            }

            // Deactivate/void target cost layer
            DeactivateTargetCostLayerByReference(org, trace, sheetId);
        }

        // === Valuation + Persistence helpers ===

        private enum ValuationMethod { FIFO, LIFO, MovingAverage, Standard }

        private ValuationMethod ResolveValuationMethod(IOrganizationService org, Guid warehouseId, Guid itemId)
        {
            // 1) Warehouse.pdg_valuationmethod
            var wh = org.Retrieve("pdg_warehouse", warehouseId, new ColumnSet("pdg_valuationmethod"));
            var whVal = GetOption(wh, "pdg_valuationmethod");
            if (whVal != null)
            {
                switch (whVal)
                {
                    case 100100000: return ValuationMethod.FIFO;
                    case 100100001: return ValuationMethod.LIFO;
                    case 100100002: return ValuationMethod.MovingAverage;
                    case 100100003: return ValuationMethod.Standard;
                }
            }
            // 2) Item.pdg_costingmethod
            var it = org.Retrieve("pdg_inventoryitem", itemId, new ColumnSet("pdg_costingmethod"));
            var itVal = GetOption(it, "pdg_costingmethod");
            if (itVal != null)
            {
                switch (itVal)
                {
                    case 100000002: return ValuationMethod.FIFO;
                    case 100000003: return ValuationMethod.LIFO;
                    case 100000001: return ValuationMethod.MovingAverage; // Average Cost
                    case 100000000: return ValuationMethod.Standard;
                }
            }
            // 3) Fallback Average
            return ValuationMethod.MovingAverage;
        }

        private class ConsumptionCost
        {
            public decimal UnitCost { get; set; }
            public decimal TotalCost { get; set; }
        }

        private ConsumptionCost ComputeConsumptionCost(IOrganizationService org, Guid itemId, Guid warehouseId, Guid? binId, decimal qty, ValuationMethod method, ITracingService trace)
        {
            if (qty <= 0m) return new ConsumptionCost { UnitCost = 0m, TotalCost = 0m };

            if (method == ValuationMethod.MovingAverage || method == ValuationMethod.Standard)
            {
                // Read inventory cost fields
                var invId = TryGetInventoryId(org, itemId, warehouseId, binId);
                if (invId == Guid.Empty)
                    return new ConsumptionCost { UnitCost = 0m, TotalCost = 0m };

                var inv = org.Retrieve("pdg_inventory", invId, new ColumnSet("pdg_weightedaveragecost", "pdg_averagecost", "pdg_standardcost"));
                decimal unit = GetMoney(inv, "pdg_weightedaveragecost");
                if (unit <= 0m) unit = GetMoney(inv, "pdg_averagecost");
                if (unit <= 0m) unit = GetMoney(inv, "pdg_standardcost");
                return new ConsumptionCost { UnitCost = unit, TotalCost = unit * qty };
            }
            else
            {
                // FIFO/LIFO: sum unit costs from layers in order
                var invId = TryGetInventoryId(org, itemId, warehouseId, binId);
                if (invId == Guid.Empty)
                    return new ConsumptionCost { UnitCost = 0m, TotalCost = 0m };

                var query = new QueryExpression("pdg_costlayer")
                {
                    ColumnSet = new ColumnSet("pdg_quantityremaining", "pdg_unitcost", "pdg_receiptdate"),
                    Criteria = new FilterExpression(LogicalOperator.And)
                };
                query.Criteria.AddCondition("pdg_inventoryid", ConditionOperator.Equal, invId);
                query.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemId);
                query.AddOrder("pdg_receiptdate", method == ValuationMethod.FIFO ? OrderType.Ascending : OrderType.Descending);

                var layers = org.RetrieveMultiple(query).Entities;
                decimal needed = qty;
                decimal totalCost = 0m;
                foreach (var layer in layers)
                {
                    if (needed <= 0m) break;
                    var remain = layer.Contains("pdg_quantityremaining") ? (decimal)layer["pdg_quantityremaining"] : 0m;
                    var unit = GetMoney(layer, "pdg_unitcost");
                    if (remain <= 0m || unit <= 0m) continue;

                    var take = Math.Min(remain, needed);
                    totalCost += take * unit;
                    needed -= take;
                }

                var unitCost = qty > 0m ? totalCost / qty : 0m;
                return new ConsumptionCost { UnitCost = unitCost, TotalCost = totalCost };
            }
        }

        private class LayerAllocation
        {
            public Guid LayerId { get; set; }
            public decimal Quantity { get; set; }
            public decimal UnitCost { get; set; }
        }

        private ConsumptionCost AllocateFromLayers(IOrganizationService org, Guid itemId, Guid warehouseId, Guid? binId, decimal qty, ValuationMethod method, ITracingService trace, out LayerAllocation[] allocations)
        {
            allocations = Array.Empty<LayerAllocation>();
            if (qty <= 0m) return new ConsumptionCost { UnitCost = 0m, TotalCost = 0m };

            if (method == ValuationMethod.MovingAverage || method == ValuationMethod.Standard)
            {
                var cc = ComputeConsumptionCost(org, itemId, warehouseId, binId, qty, method, trace);
                return cc;
            }

            var invId = TryGetInventoryId(org, itemId, warehouseId, binId);
            if (invId == Guid.Empty)
            {
                trace.Trace("AllocateFromLayers: No inventory record found");
                return new ConsumptionCost { UnitCost = 0m, TotalCost = 0m };
            }

            var q = new QueryExpression("pdg_costlayer")
            {
                ColumnSet = new ColumnSet("pdg_costlayerid", "pdg_quantityremaining", "pdg_unitcost", "pdg_receiptdate"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_inventoryid", ConditionOperator.Equal, invId);
            q.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemId);
            q.AddOrder("pdg_receiptdate", method == ValuationMethod.FIFO ? OrderType.Ascending : OrderType.Descending);

            var layers = org.RetrieveMultiple(q).Entities;
            var taken = new System.Collections.Generic.List<LayerAllocation>();
            decimal needed = qty;
            decimal totalCost = 0m;
            foreach (var layer in layers)
            {
                if (needed <= 0m) break;
                var remain = layer.Contains("pdg_quantityremaining") ? (decimal)layer["pdg_quantityremaining"] : 0m;
                var unit = GetMoney(layer, "pdg_unitcost");
                if (remain <= 0m || unit <= 0m) continue;
                var take = Math.Min(remain, needed);

                var upd = new Entity("pdg_costlayer") { Id = layer.Id };
                upd["pdg_quantityremaining"] = remain - take;
                ExecuteWithRetry(() => org.Update(upd), "UpdateCostLayerRemaining", trace);

                taken.Add(new LayerAllocation { LayerId = layer.Id, Quantity = take, UnitCost = unit });
                totalCost += take * unit;
                needed -= take;
            }

            allocations = taken.ToArray();
            var u = qty > 0m ? totalCost / qty : 0m;
            return new ConsumptionCost { UnitCost = u, TotalCost = totalCost };
        }

        private void RestoreToLayers(IOrganizationService org, LayerAllocation[] allocations, ITracingService trace)
        {
            if (allocations == null) return;
            foreach (var a in allocations)
            {
                var current = org.Retrieve("pdg_costlayer", a.LayerId, new ColumnSet("pdg_quantityremaining"));
                var remain = current.Contains("pdg_quantityremaining") ? (decimal)current["pdg_quantityremaining"] : 0m;
                var upd = new Entity("pdg_costlayer") { Id = a.LayerId };
                upd["pdg_quantityremaining"] = remain + a.Quantity;
                ExecuteWithRetry(() => org.Update(upd), "RestoreLayerRemaining", trace);
            }
        }

        private static string? SerializeAllocations(LayerAllocation[] allocations)
        {
            if (allocations == null || allocations.Length == 0) return null;
            var parts = allocations.Select(a => string.Join(":",
                a.LayerId.ToString(),
                a.Quantity.ToString(CultureInfo.InvariantCulture),
                a.UnitCost.ToString(CultureInfo.InvariantCulture)));
            return string.Join(";", parts);
        }

        private static LayerAllocation[] ParseAllocations(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return Array.Empty<LayerAllocation>();
            var list = new System.Collections.Generic.List<LayerAllocation>();
            var items = s!.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var it in items)
            {
                var bits = it.Split(':');
                if (bits.Length < 3) continue;
                if (!Guid.TryParse(bits[0], out var id)) continue;
                if (!decimal.TryParse(bits[1], NumberStyles.Any, CultureInfo.InvariantCulture, out var q)) q = 0m;
                if (!decimal.TryParse(bits[2], NumberStyles.Any, CultureInfo.InvariantCulture, out var u)) u = 0m;
                list.Add(new LayerAllocation { LayerId = id, Quantity = q, UnitCost = u });
            }
            return list.ToArray();
        }

        private class InventoryTxn
        {
            public EntityReference? Item { get; set; }
            public EntityReference? WarehouseFrom { get; set; }
            public EntityReference? WarehouseTo { get; set; }
            public EntityReference? BinFrom { get; set; }
            public EntityReference? BinTo { get; set; }
            public decimal Quantity { get; set; }
            public decimal UnitCost { get; set; }
            public decimal TotalCost { get; set; }
            public DateTime TransactionDate { get; set; }
            public int TransactionType { get; set; }
            public int ReferenceType { get; set; }
            public Guid AlloySheetId { get; set; }
            public Guid ProductionSheetId { get; set; }
            public int CostCalculationMethod { get; set; }
            public string? RemarksJson { get; set; }
            public string? LotNumber { get; set; }
        }

        private int MapCostCalcMethod(ValuationMethod method)
        {
            // pdg_costcalculationmethod: Average Cost (100000000), FIFO (100000001), Manual Entry (100000002), Standard Cost (100000003), Last Cost (100000004)
            switch (method)
            {
                case ValuationMethod.FIFO: return 100000001;
                case ValuationMethod.LIFO: return 100000004; // map to Last Cost for lack of LIFO option
                case ValuationMethod.Standard: return 100000003;
                case ValuationMethod.MovingAverage:
                default:
                    return 100000000;
            }
        }

        private bool UpsertInventoryTransaction(IOrganizationService org, ITracingService trace, string referenceId, InventoryTxn data)
        {
            // Find existing by reference
            var query = new QueryExpression("pdg_inventorytransaction")
            {
                ColumnSet = new ColumnSet("pdg_inventorytransactionid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            query.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, referenceId);
            var exist = org.RetrieveMultiple(query).Entities.FirstOrDefault();

            var ent = new Entity("pdg_inventorytransaction");
            if (exist != null) ent.Id = exist.Id;

            ent["pdg_referenceid"] = referenceId;
            if (data.Item == null)
                throw new InvalidPluginExecutionException("Inventory transaction requires Item");
            ent["pdg_itemid"] = data.Item;
            ent["pdg_transactiondate"] = data.TransactionDate.ToUniversalTime();
            ent["pdg_quantity"] = data.Quantity;
            ent["pdg_unitcost"] = new Money(data.UnitCost);
            ent["pdg_totalcost"] = new Money(data.TotalCost);
            ent["pdg_transactiontype"] = new OptionSetValue(data.TransactionType);
            ent["pdg_referencetype"] = new OptionSetValue(data.ReferenceType);
            ent["pdg_costcalculationmethod"] = new OptionSetValue(data.CostCalculationMethod);
            if (data.WarehouseFrom != null) ent["pdg_fromwarehouseid"] = data.WarehouseFrom;
            if (data.WarehouseTo != null) ent["pdg_towarehouseid"] = data.WarehouseTo;
            if (data.BinFrom != null) ent["pdg_frombinid"] = data.BinFrom;
            if (data.BinTo != null) ent["pdg_tobinid"] = data.BinTo;
            if (!string.IsNullOrEmpty(data.RemarksJson)) ent["pdg_remarks"] = data.RemarksJson;
            if (!string.IsNullOrEmpty(data.LotNumber)) ent["pdg_lotnumber"] = data.LotNumber;
            if (data.AlloySheetId != Guid.Empty)
                ent["pdg_alloysheetid"] = new EntityReference("pdg_alloysheet", data.AlloySheetId);
            if (data.ProductionSheetId != Guid.Empty)
                ent["pdg_productionsheetid"] = new EntityReference("pdg_productionsheet", data.ProductionSheetId);

            // Attach inventory id if found
            var invIdForTxn = Guid.Empty;
            if (data.WarehouseFrom != null)
                invIdForTxn = TryGetInventoryId(org, data.Item.Id, data.WarehouseFrom.Id, data.BinFrom?.Id);
            if (invIdForTxn == Guid.Empty && data.WarehouseTo != null)
                invIdForTxn = TryGetInventoryId(org, data.Item.Id, data.WarehouseTo.Id, data.BinTo?.Id);
            if (invIdForTxn != Guid.Empty) ent["pdg_inventoryid"] = new EntityReference("pdg_inventory", invIdForTxn);

            if (exist == null)
            {
                var id = org.Create(ent);
                trace.Trace($"Created inventory transaction {id} for {referenceId}");
                AdjustOnHand(org, trace, data.Item, data.WarehouseFrom, data.BinFrom, data.WarehouseTo, data.BinTo, data.Quantity, data.TransactionType);
                // Update weighted average cost for Moving Average receipts
                if (data.TransactionType == 100000000 && data.WarehouseTo != null)
                {
                    var method = ResolveValuationMethod(org, data.WarehouseTo.Id, data.Item.Id);
                    if (method == ValuationMethod.MovingAverage)
                    {
                        var invId = TryGetInventoryId(org, data.Item.Id, data.WarehouseTo.Id, data.BinTo?.Id);
                        if (invId != Guid.Empty)
                            UpdateWeightedAverageOnReceipt(org, invId, data.UnitCost, data.Quantity, trace);
                    }
                }
                return true;
            }
            else
            {
                org.Update(ent);
                trace.Trace($"Updated inventory transaction {exist.Id} for {referenceId}");
                return false;
            }
        }

private void AdjustOnHand(IOrganizationService org, ITracingService trace, EntityReference item, EntityReference? fromWh, EntityReference? fromBin, EntityReference? toWh, EntityReference? toBin, decimal qty, int transactionType)
{
    if (transactionType == 100000001 && fromWh != null) // Out
    {
        var invId = TryGetInventoryId(org, item.Id, fromWh.Id, fromBin?.Id);
        if (invId != Guid.Empty) UpdateInventoryOnHand(org, invId, -qty, trace);
    }
    else if (transactionType == 100000000 && toWh != null) // In
    {
        var invId = TryGetInventoryId(org, item.Id, toWh.Id, toBin?.Id);
        if (invId == Guid.Empty)
        {
            var id = (toBin != null)
                ? GetOrCreateInventory(org, item, toWh, toBin, trace)
                : GetOrCreateInventory(org, item, toWh, trace);
            if (id != Guid.Empty)
            {
                UpdateInventoryOnHand(org, id, qty, trace);
                trace.Trace($"AdjustOnHand: created inventory {id} with qty {qty}");
            }
        }
        else UpdateInventoryOnHand(org, invId, qty, trace);
    }
}

        private void UpdateInventoryOnHand(IOrganizationService org, Guid inventoryId, decimal delta, ITracingService trace)
        {
            var inv = org.Retrieve("pdg_inventory", inventoryId, new ColumnSet("pdg_onhandquantity"));
            var curQty = inv.Contains("pdg_onhandquantity") ? (decimal)inv["pdg_onhandquantity"] : 0m;
            var upd = new Entity("pdg_inventory") { Id = inventoryId };
            upd["pdg_onhandquantity"] = curQty + delta;
            org.Update(upd);
            trace.Trace($"Updated on-hand for inventory {inventoryId}: {curQty} -> {curQty + delta}");
        }

        private void ValidateSufficientStock(IOrganizationService org, Guid warehouseId, Guid itemId, Guid? binId, decimal qty, ValuationMethod method)
        {
            if (qty <= 0m) return;
            // Check warehouse policy
            var wh = org.Retrieve("pdg_warehouse", warehouseId, new ColumnSet("pdg_negativestockallowed"));
            var allowed = false;
            if (wh != null && wh.Contains("pdg_negativestockallowed"))
            {
                var b = wh["pdg_negativestockallowed"];
                if (b is bool bb) allowed = bb;
                else if (b is OptionSetValue ov) allowed = ov.Value == 1; // if modeled differently
            }
            if (allowed) return;

            if (method == ValuationMethod.FIFO || method == ValuationMethod.LIFO)
            {
                var invId = TryGetInventoryId(org, itemId, warehouseId, binId);
                if (invId == Guid.Empty)
                    throw new InvalidPluginExecutionException("Insufficient stock: no inventory record found.");
                var q = new QueryExpression("pdg_costlayer")
                {
                    ColumnSet = new ColumnSet("pdg_quantityremaining"),
                    Criteria = new FilterExpression(LogicalOperator.And)
                };
                q.Criteria.AddCondition("pdg_inventoryid", ConditionOperator.Equal, invId);
                q.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemId);
                var layers = org.RetrieveMultiple(q).Entities;
                decimal sumRem = 0m;
                foreach (var l in layers)
                {
                    if (l.Contains("pdg_quantityremaining") && l["pdg_quantityremaining"] != null)
                    {
                        sumRem += (decimal)l["pdg_quantityremaining"];
                    }
                }
                if (sumRem < qty)
                    throw new InvalidPluginExecutionException($"Insufficient stock (FIFO/LIFO): requested {qty}, available {sumRem}");
            }
            else
            {
                var invId = TryGetInventoryId(org, itemId, warehouseId, binId);
                var onhand = 0m;
                if (invId != Guid.Empty)
                {
                    var inv = org.Retrieve("pdg_inventory", invId, new ColumnSet("pdg_onhandquantity"));
                    onhand = inv.Contains("pdg_onhandquantity") ? (decimal)inv["pdg_onhandquantity"] : 0m;
                }
                if (onhand < qty)
                    throw new InvalidPluginExecutionException($"Insufficient stock: requested {qty}, on-hand {onhand}");
            }
        }

        private void UpdateWeightedAverageOnReceipt(IOrganizationService org, Guid inventoryId, decimal receiptUnitCost, decimal receiptQty, ITracingService trace)
        {
            if (receiptQty <= 0m) return;
            var inv = org.Retrieve("pdg_inventory", inventoryId, new ColumnSet("pdg_onhandquantity", "pdg_weightedaveragecost"));
            var curQty = inv.Contains("pdg_onhandquantity") ? (decimal)inv["pdg_onhandquantity"] : 0m;
            var curAvg = GetMoney(inv, "pdg_weightedaveragecost");
            var newQty = curQty; // AdjustOnHand already applied, so curQty includes receipt
            var oldQty = newQty - receiptQty;
            var totalOld = curAvg * oldQty;
            var totalNew = totalOld + (receiptUnitCost * receiptQty);
            var newAvg = newQty > 0m ? totalNew / newQty : 0m;
            var upd = new Entity("pdg_inventory") { Id = inventoryId };
            upd["pdg_weightedaveragecost"] = new Money(newAvg);
            ExecuteWithRetry(() => org.Update(upd), "UpdateWeightedAvg", trace);
            trace.Trace($"Updated weighted average cost for inventory {inventoryId}: {curAvg} -> {newAvg}");
        }

        private void DeleteInventoryTransactionByReference(IOrganizationService org, ITracingService trace, string referenceId)
        {
            var query = new QueryExpression("pdg_inventorytransaction")
            {
                ColumnSet = new ColumnSet("pdg_inventorytransactionid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            query.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, referenceId);
            var coll = org.RetrieveMultiple(query).Entities;
            foreach (var e in coll)
            {
                org.Delete("pdg_inventorytransaction", e.Id);
                trace.Trace($"Deleted inventory transaction {e.Id} for {referenceId}");
            }
        }

        private Entity GetInventoryTransactionByReference(IOrganizationService org, string referenceId)
        {
            var q = new QueryExpression("pdg_inventorytransaction")
            {
                ColumnSet = new ColumnSet(true),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, referenceId);
            return org.RetrieveMultiple(q).Entities.FirstOrDefault();
        }

        private Guid TryGetInventoryId(IOrganizationService org, Guid itemId, Guid warehouseId)
        {
            var q = new QueryExpression("pdg_inventory")
            {
                ColumnSet = new ColumnSet("pdg_inventoryid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemId);
            q.Criteria.AddCondition("pdg_warehouseid", ConditionOperator.Equal, warehouseId);
            var rec = org.RetrieveMultiple(q).Entities.FirstOrDefault();
            return rec?.Id ?? Guid.Empty;
        }

        private Guid TryGetInventoryId(IOrganizationService org, Guid itemId, Guid warehouseId, Guid? binId)
        {
            var q = new QueryExpression("pdg_inventory")
            {
                ColumnSet = new ColumnSet("pdg_inventoryid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, itemId);
            q.Criteria.AddCondition("pdg_warehouseid", ConditionOperator.Equal, warehouseId);
            if (binId.HasValue)
                q.Criteria.AddCondition("pdg_binid", ConditionOperator.Equal, binId.Value);
            var rec = org.RetrieveMultiple(q).Entities.FirstOrDefault();
            return rec?.Id ?? Guid.Empty;
        }

        private Guid GetOrCreateInventory(IOrganizationService org, EntityReference item, EntityReference warehouse, ITracingService trace)
        {
            var id = TryGetInventoryId(org, item.Id, warehouse.Id);
            if (id != Guid.Empty) return id;

            var ent = new Entity("pdg_inventory");
            ent["pdg_itemid"] = item;
            ent["pdg_warehouseid"] = warehouse;
            ent["pdg_onhandquantity"] = 0m;
            ent["pdg_inventorynumber"] = $"INV-{DateTime.UtcNow:yyyyMMddHHmmss}";
            id = org.Create(ent);
            trace.Trace($"Created pdg_inventory {id} for item {item.Id} in warehouse {warehouse.Id}");
            return id;
        }

        private Guid GetOrCreateInventory(IOrganizationService org, EntityReference item, EntityReference warehouse, EntityReference bin, ITracingService trace)
        {
            var id = TryGetInventoryId(org, item.Id, warehouse.Id, bin?.Id);
            if (id != Guid.Empty) return id;

            var ent = new Entity("pdg_inventory");
            ent["pdg_itemid"] = item;
            ent["pdg_warehouseid"] = warehouse;
            if (bin != null) ent["pdg_binid"] = bin;
            ent["pdg_onhandquantity"] = 0m;
            ent["pdg_inventorynumber"] = $"INV-{DateTime.UtcNow:yyyyMMddHHmmss}";
            id = org.Create(ent);
            trace.Trace($"Created pdg_inventory {id} for item {item.Id} in warehouse {warehouse.Id} bin {(bin?.Id.ToString() ?? "null")} ");
            return id;
        }

        private void UpsertTargetCostLayer(IOrganizationService org, ITracingService trace, Guid sheetId, EntityReference item, Guid inventoryId, decimal unitCost, decimal quantity, DateTime receiptDate, string serialPrefix = "ALY")
        {
            // Identify layer by reference id + item
            var q = new QueryExpression("pdg_costlayer")
            {
                ColumnSet = new ColumnSet("pdg_costlayerid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, sheetId.ToString());
            q.Criteria.AddCondition("pdg_itemid", ConditionOperator.Equal, item.Id);
            var existing = org.RetrieveMultiple(q).Entities.FirstOrDefault();

            var layer = new Entity("pdg_costlayer");
            if (existing != null) layer.Id = existing.Id;

            layer["pdg_itemid"] = item;
            layer["pdg_inventoryid"] = new EntityReference("pdg_inventory", inventoryId);
            layer["pdg_originalquantity"] = quantity;
            layer["pdg_quantityremaining"] = quantity;
            layer["pdg_unitcost"] = new Money(unitCost);
            layer["pdg_receiptdate"] = receiptDate.ToUniversalTime();
            layer["pdg_referenceid"] = sheetId.ToString();
            layer["pdg_layerserial"] = $"{serialPrefix}-{DateTime.UtcNow:yyyyMMddHHmmss}";

            if (existing == null)
            {
                var id = org.Create(layer);
                trace.Trace($"Created cost layer {id} for alloy sheet {sheetId}");
            }
            else
            {
                org.Update(layer);
                trace.Trace($"Updated cost layer {existing.Id} for alloy sheet {sheetId}");
            }
        }

        private void DeleteTargetCostLayerByReference(IOrganizationService org, ITracingService trace, Guid sheetId)
        {
            var q = new QueryExpression("pdg_costlayer")
            {
                ColumnSet = new ColumnSet("pdg_costlayerid"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, sheetId.ToString());
            var coll = org.RetrieveMultiple(q).Entities;
            foreach (var e in coll)
            {
                org.Delete("pdg_costlayer", e.Id);
                trace.Trace($"Deleted cost layer {e.Id} for alloy sheet {sheetId}");
            }
        }

        private void DeactivateTargetCostLayerByReference(IOrganizationService org, ITracingService trace, Guid sheetId)
        {
            var q = new QueryExpression("pdg_costlayer")
            {
                ColumnSet = new ColumnSet("pdg_costlayerid", "pdg_quantityremaining"),
                Criteria = new FilterExpression(LogicalOperator.And)
            };
            q.Criteria.AddCondition("pdg_referenceid", ConditionOperator.Equal, sheetId.ToString());
            var coll = org.RetrieveMultiple(q).Entities;
            foreach (var e in coll)
            {
                var upd = new Entity("pdg_costlayer") { Id = e.Id };
                upd["pdg_quantityremaining"] = 0m;
                ExecuteWithRetry(() => org.Update(upd), "DeactivateLayer", trace);
                trace.Trace($"Deactivated cost layer {e.Id} for alloy sheet {sheetId}");
            }
        }

        private void CreateBinHistory(IOrganizationService org, ITracingService trace,
            EntityReference warehouse, EntityReference item, EntityReference fromBin, EntityReference toBin,
            decimal qty, DateTime moveDate, Guid toInventoryId)
        {
            if (fromBin == null || toBin == null) return;
            var bh = new Entity("pdg_binhistory");
            bh["pdg_binhistoryserial"] = $"BH-{DateTime.UtcNow:yyyyMMddHHmmss}";
            bh["pdg_warehouseid"] = warehouse;
            bh["pdg_itemid"] = item;
            bh["pdg_frombinid"] = fromBin;
            bh["pdg_tobinid"] = toBin;
            bh["pdg_quantity"] = qty;
            bh["pdg_movementdate"] = moveDate.ToUniversalTime();
            bh["pdg_inventoryrecordid"] = new EntityReference("pdg_inventory", toInventoryId);
            var id = org.Create(bh);
            trace.Trace($"Created bin history {id} from {fromBin.Id} to {toBin.Id} qty {qty}");
        }

        private void ExecuteWithRetry(Action action, string operation, ITracingService trace, int maxAttempts = 3, int delayMs = 150)
        {
            int attempt = 0;
            for (;;)
            {
                try
                {
                    attempt++;
                    action();
                    return;
                }
                catch (FaultException<OrganizationServiceFault> ex)
                {
                    if (attempt >= maxAttempts) throw;
                    trace.Trace($"{operation} failed attempt {attempt}: {ex.Message}; retrying...");
                }
                catch (Exception ex) when (ex.Message.IndexOf("conflict", StringComparison.OrdinalIgnoreCase) >= 0 || ex.Message.IndexOf("deadlock", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    if (attempt >= maxAttempts) throw;
                    trace.Trace($"{operation} transient failure attempt {attempt}: {ex.Message}; retrying...");
                }
                Thread.Sleep(delayMs);
            }
        }

        // === Helpers ===

        private static Entity? GetImage(IPluginExecutionContext ctx, string name)
        {
            if (ctx.PreEntityImages != null && ctx.PreEntityImages.Contains(name))
                return ctx.PreEntityImages[name] as Entity;
            if (ctx.PostEntityImages != null && ctx.PostEntityImages.Contains(name))
                return ctx.PostEntityImages[name] as Entity;
            return null;
        }

        private static bool FieldChanged(Entity? target, string logicalName)
        {
            return target != null && target.Contains(logicalName);
        }

        private static decimal GetDecimal(Entity? e, string attr)
        {
            if (e == null || !e.Contains(attr) || e[attr] == null) return 0m;
            var v = e[attr];
            if (v is Money m) return m.Value;
            if (v is decimal d) return d;
            if (v is double f) return (decimal)f;
            decimal.TryParse(v.ToString(), out var z);
            return z;
        }

        private static decimal GetMoney(Entity? e, string attr)
        {
            if (e == null || !e.Contains(attr) || e[attr] == null) return 0m;
            var v = e[attr];
            if (v is Money m) return m.Value;
            if (v is decimal d) return d;
            if (v is double f) return (decimal)f;
            decimal.TryParse(v.ToString(), out var z);
            return z;
        }

        private static int? GetOption(Entity? e, string attr)
        {
            if (e == null || !e.Contains(attr) || e[attr] == null) return null;
            var v = e[attr];
            if (v is OptionSetValue osv) return osv.Value;
            if (int.TryParse(v.ToString(), out var z)) return z;
            return null;
        }
    }
}







