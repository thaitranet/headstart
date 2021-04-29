import { Input, OnInit } from '@angular/core'
import { faTimes, faTrashAlt } from '@fortawesome/free-solid-svg-icons'
import { groupBy as _groupBy, isEqual, uniqWith } from 'lodash'
import { HSLineItem } from '@ordercloud/headstart-sdk'
import { getPrimaryLineItemImage } from 'src/app/services/images.helpers'
import { CancelReturnReason } from '../../orders/order-return/order-return-table/models/cancel-return-translations.enum'
import { NgxSpinnerService } from 'ngx-spinner'
import { ShopperContextService } from 'src/app/services/shopper-context/shopper-context.service'
import { OrderType } from 'src/app/models/order.types'
import { LineItemGroupSupplier } from 'src/app/models/line-item.types'
import { QtyChangeEvent } from 'src/app/models/product.types'
import { NgChanges } from 'src/app/models/ng-changes.types'
import { CheckoutService } from 'src/app/services/order/checkout.service'
import { Address } from 'ordercloud-javascript-sdk'

interface IDeletingLineItem {
  isDeleting: boolean
  lineItemID: string
}
export abstract class OCMParentTableComponent implements OnInit {
  @Input() set lineItems(lineItems: HSLineItem[]) {
    this._lineItems = lineItems
    this.initLineItems() // if line items change we need to regroup them
  }
  @Input() set groupByKits(bool: boolean) {
    this._groupByKits = bool
    this.initLineItems()
  }

  @Input() supplierData: LineItemGroupSupplier[]
  @Input() readOnly: boolean
  @Input() orderType: OrderType
  @Input() hideStatus = false
  @Input() displayShippingInfo = false
  @Input() invalidItem
  closeIcon = faTimes
  faTrashAlt = faTrashAlt
  _supplierArray: any[]
  suppliers: LineItemGroupSupplier[]
  selectedSupplier: LineItemGroupSupplier
  liGroupedByShipFrom: HSLineItem[][]
  updatingLiIDs: string[] = []
  _groupByKits: boolean
  _lineItems: HSLineItem[] = []
  _orderCurrency: string
  _changedLineItemID: string
  _supplierData: LineItemGroupSupplier[]
  showComments: Record<string, string> = {}
  deletingLineItem: IDeletingLineItem = {
    isDeleting: false,
    lineItemID: null,
  }
  constructor(
    public context: ShopperContextService,
    private spinner: NgxSpinnerService,
    private checkoutService: CheckoutService
  ) {
    this._orderCurrency = this.context.currentUser.get().Currency
  }

  ngOnInit(): void {
    this.spinner.show() // visibility is handled by *ngIf
  }

  ngOnChanges(changes: NgChanges<OCMParentTableComponent>) {
    // if not being used in checkout-shipment then we will get and set necessary supplier data
    // in the checkout-shipment component we pass this information in from parent
    if (
      changes?.displayShippingInfo?.currentValue !== true &&
      changes?.lineItems?.currentValue
    ) {
      this.setSupplierData()
    } else if (changes?.supplierData?.currentValue) {
      this.buildSupplierArray(changes?.supplierData?.currentValue)
    }
  }

  shouldDisplayAddress(shipFrom: Partial<Address>): boolean {
    return shipFrom?.Street1 && shipFrom.Street1 !== null
  }

  initLineItems(): void {
    if (!this._lineItems || !this._lineItems.length) {
      return
    }
    this.liGroupedByShipFrom = this.groupLineItemsByShipFrom(this._lineItems)
  }

  async setSupplierData(): Promise<void> {
    const supplierArray = uniqWith(
      this._lineItems?.map((li) => ({
        supplierID: li?.SupplierID,
        ShipFromAddressID: li?.ShipFromAddressID,
      })),
      isEqual
    )
    if (
      JSON.stringify(supplierArray) !== JSON.stringify(this._supplierArray) &&
      !this.displayShippingInfo
    ) {
      this._supplierArray = supplierArray
      const supplierList = await this.checkoutService.buildSupplierData(
        this._lineItems
      )
      this.buildSupplierArray(supplierList)
    }
  }

  buildSupplierArray(supplierList: LineItemGroupSupplier[]) {
    const suppliers: LineItemGroupSupplier[] = []
    if (this.liGroupedByShipFrom) {
      this.liGroupedByShipFrom.forEach((group) => {
        suppliers.push(
          supplierList.find((s) => s.shipFrom.ID === group[0].ShipFromAddressID)
        )
      })
    }
    this.suppliers = suppliers
  }

  groupLineItemsByShipFrom(lineItems: HSLineItem[]): HSLineItem[][] {
    const supplierLineItems = this._groupByKits
      ? lineItems.filter((li) => !li.xp.KitProductID)
      : lineItems
    const liGroups = _groupBy(supplierLineItems, (li) => li.ShipFromAddressID)
    return Object.values(liGroups).sort((a, b) => {
      const nameA = a[0]?.ShipFromAddressID?.toUpperCase() // ignore upper and lowercase
      const nameB = b[0]?.ShipFromAddressID?.toUpperCase() // ignore upper and lowercase
      return nameA.localeCompare(nameB)
    })
  }

  async removeLineItem(lineItemID: string): Promise<void> {
    this.deletingLineItem = {
      lineItemID: lineItemID,
      isDeleting: true,
    }
    await this.context.order.cart.remove(lineItemID)
    this.deletingLineItem = {
      lineItemID: null,
      isDeleting: false,
    }
  }

  toProductDetails(
    productID: string,
    configurationID: string,
    documentID: string
  ): void {
    if (!this.invalidItem) {
      this.context.router.toProductDetails(productID)
    }
  }

  async changeQuantity(
    lineItemID: string,
    event: QtyChangeEvent
  ): Promise<void> {
    if (event.valid) {
      const li = this.getLineItem(lineItemID)
      li.Quantity = event.qty
      const { ProductID, Specs, Quantity, xp } = li

      try {
        // ACTIVATE SPINNER/DISABLE INPUT IF QTY BEING UPDATED
        this.updatingLiIDs.push(lineItemID)
        await this.context.order.cart.setQuantity({
          ProductID,
          Specs,
          Quantity,
          xp,
        })
      } finally {
        // REMOVE SPINNER/ENABLE INPUT IF QTY NO LONGER BEING UPDATED
        this.updatingLiIDs.splice(this.updatingLiIDs.indexOf(lineItemID), 1)
      }
    }
  }

  async changeComments(lineItemID: string, comments: string): Promise<void> {
    try {
      // ACTIVATE SPINNER/DISABLE INPUT IF QTY BEING UPDATED
      this.updatingLiIDs.push(lineItemID)
      await this.context.order.cart.addSupplierComments(lineItemID, comments)
    } finally {
      // REMOVE SPINNER/ENABLE INPUT IF QTY NO LONGER BEING UPDATED
      this.updatingLiIDs.splice(this.updatingLiIDs.indexOf(lineItemID), 1)
    }
  }

  isQtyChanging(lineItemID: string): boolean {
    return this.updatingLiIDs.includes(lineItemID)
  }

  getImageUrl(lineItemID: string): string {
    return getPrimaryLineItemImage(
      lineItemID,
      this._lineItems,
      this.context.currentUser.get()
    )
  }

  getLineItem(lineItemID: string): HSLineItem {
    return this._lineItems.find((li) => li.ID === lineItemID)
  }

  hasReturnInfo(): boolean {
    return this._lineItems.some((li) => !!(li.xp as any)?.LineItemReturnInfo)
  }

  hasCancelInfo(): boolean {
    return this._lineItems.some((li) => !!(li.xp as any)?.LineItemCancelInfo)
  }

  getReturnReason(reasonCode: string): string {
    return CancelReturnReason[reasonCode] as string
  }
}
