import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, firstValueFrom, Observable } from 'rxjs';

interface LoginResponse {
  token: string;
  rol?: 'ROLE_ADMIN' | 'ROLE_CLIENTE' | string;
  username?: string;
  idcliente?: number | null;
}

interface RegisterResponse {
  mensaje?: string;
  idusuario?: number;
  idcliente?: number;
  username?: string;
  rol?: string;
}

interface Cliente {
  idcliente: number;
  nombres: string;
  apellidos: string;
  correo: string;
  telefono: string;
  estado: string | boolean;
}

interface Producto {
  idproducto: number;
  nombre: string;
  precio: number;
  stock: number;
  estado?: string | boolean;
}

interface Venta {
  idventa: number;
  idcliente: number;
  idproducto: number;
  cantidad: number;
  total?: number;
  estado?: string;
  fecha?: string;
  sagaId?: string;
}

interface SagaResponse {
  sagaId?: string;
  estado?: string;
  mensaje?: string;
  venta?: Venta;
  ventas?: Venta[];
  total?: number;
}

interface CartItem {
  producto: Producto;
  cantidad: number;
}

interface SagaLog {
  id: number;
  sagaId: string;
  idcliente: number;
  tipo: string;
  estado: string;
  pasoFallido?: string;
  mensajeCliente?: string;
  detalleTecnico?: string;
  stockCompensado?: boolean;
  fecha?: string;
}

interface PurchaseGroup {
  key: string;
  sagaId?: string;
  fecha?: string;
  estado?: string;
  ventas: Venta[];
  total: number;
}

type AdminTab = 'resumen' | 'clientes' | 'productos' | 'ventas' | 'logs' | 'saga';
type ClientTab = 'tienda' | 'historial';

type Trackable = Cliente | Producto | Venta | SagaLog;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  readonly token = signal(localStorage.getItem('saga_token') ?? '');
  readonly role = signal(localStorage.getItem('saga_role') ?? '');
  readonly username = signal(localStorage.getItem('saga_username') ?? '');
  readonly idcliente = signal(Number(localStorage.getItem('saga_idcliente') || 0) || null);

  readonly adminTab = signal<AdminTab>('resumen');
  readonly clientTab = signal<ClientTab>('tienda');
  readonly authMode = signal<'login' | 'register'>('login');
  readonly showAdminLogin = signal(false);
  readonly showProductForm = signal(false);
  readonly actingAsClient = signal(false);
  readonly loading = signal(false);
  readonly actionLoading = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly clientAuthError = signal('');
  readonly clientAuthSuccess = signal('');
  readonly adminAuthError = signal('');

  readonly clientes = signal<Cliente[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly productSaleCounts = signal<Record<number, number>>({});
  readonly ventas = signal<Venta[]>([]);
  readonly misVentas = signal<Venta[]>([]);
  readonly sagaLogs = signal<SagaLog[]>([]);
  readonly cart = signal<CartItem[]>([]);
  readonly receiptCart = signal<CartItem[]>([]);
  readonly selectedReceipt = signal<PurchaseGroup | null>(null);
  readonly lastSaga = signal<SagaResponse | null>(null);

  clientLogin = {
    username: '',
    password: ''
  };

  adminLogin = {
    username: 'admin',
    password: 'admin123'
  };

  registerForm = {
    username: '',
    password: '',
    nombres: '',
    apellidos: '',
    correo: '',
    telefono: ''
  };

  clientBuyForm = {
    idproducto: 21,
    cantidad: 1
  };

  productQuantities: Record<number, number> = {};

  adminSaleForm = {
    idcliente: 1,
    idproducto: 21,
    cantidad: 1
  };

  productForm = {
    idproducto: null as number | null,
    nombre: '',
    precio: 0,
    stock: 0,
    estado: true
  };

  clienteForm = {
    idcliente: null as number | null,
    username: '',
    password: '',
    nombres: '',
    apellidos: '',
    correo: '',
    telefono: '',
    estado: true
  };

  readonly isLoggedIn = computed(() => Boolean(this.token()));
  readonly isAdmin = computed(() => this.role() === 'ROLE_ADMIN');
  readonly isClient = computed(() => this.role() === 'ROLE_CLIENTE');
  readonly canUseClientStore = computed(() => Boolean(this.idcliente()) && (this.isClient() || this.isAdmin()));

  readonly selectedAdminCliente = computed(() =>
    this.clientes().find((cliente) => cliente.idcliente === Number(this.adminSaleForm.idcliente))
  );

  readonly selectedAdminProducto = computed(() =>
    this.productos().find((producto) => producto.idproducto === Number(this.adminSaleForm.idproducto))
  );

  readonly selectedClientProducto = computed(() =>
    this.productos().find((producto) => producto.idproducto === Number(this.clientBuyForm.idproducto))
  );

  readonly adminEstimatedTotal = computed(() => {
    const producto = this.selectedAdminProducto();
    return producto ? producto.precio * Number(this.adminSaleForm.cantidad || 0) : 0;
  });

  readonly clientEstimatedTotal = computed(() => {
    const producto = this.selectedClientProducto();
    return producto ? producto.precio * Number(this.clientBuyForm.cantidad || 0) : 0;
  });

  readonly cartTotal = computed(() =>
    this.cart().reduce((sum, item) => sum + item.producto.precio * item.cantidad, 0)
  );

  readonly cartCount = computed(() =>
    this.cart().reduce((sum, item) => sum + item.cantidad, 0)
  );

  readonly receiptTotal = computed(() =>
    this.lastSaga()?.total ?? this.receiptCart().reduce((sum, item) => sum + item.producto.precio * item.cantidad, 0)
  );

  readonly purchaseGroups = computed<PurchaseGroup[]>(() => {
    const groups = new Map<string, PurchaseGroup>();

    for (const venta of this.misVentas()) {
      const key = venta.sagaId || `venta-${venta.idventa}`;
      const producto = this.productos().find((item) => item.idproducto === venta.idproducto);
      const total = Number(venta.total ?? ((producto?.precio || 0) * Number(venta.cantidad || 0)));
      const current = groups.get(key);

      if (current) {
        current.ventas.push(venta);
        current.total += total;
        current.estado = current.estado || venta.estado;
        current.fecha = current.fecha || venta.fecha;
      } else {
        groups.set(key, {
          key,
          sagaId: venta.sagaId,
          fecha: venta.fecha,
          estado: venta.estado,
          ventas: [venta],
          total
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      this.localFechaValue(b.fecha) - this.localFechaValue(a.fecha)
    );
  });

  readonly activeClientes = computed(() =>
    this.clientes().filter((cliente) => this.isClienteActive(cliente)).length
  );

  readonly inactiveClientes = computed(() =>
    this.clientes().filter((cliente) => !this.isClienteActive(cliente)).length
  );

  readonly totalStock = computed(() =>
    this.productos().reduce((sum, producto) => sum + Number(producto.stock || 0), 0)
  );

  readonly catalogoDisponible = computed(() =>
    this.productos().filter((producto) => this.isProductoActive(producto) && Number(producto.stock || 0) > 0)
  );

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.loadAdminDashboard();
      this.loadClientStore();
    }
    if (this.isClient()) {
      this.loadClientStore();
    }
  }

  doClientLogin(): void {
    this.doLogin(this.clientLogin, 'client');
  }

  doAdminLogin(): void {
    this.doLogin(this.adminLogin, 'admin');
  }

  registerClient(): void {
    this.clearAuthMessages();
    this.actionLoading.set(true);

    this.http.post<RegisterResponse>('/api/auth/register-cliente', this.registerForm)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.clientLogin.username = response.username || this.registerForm.username;
          this.clientLogin.password = this.registerForm.password;
          this.authMode.set('login');
          this.clientAuthSuccess.set(response.mensaje || 'Cuenta cliente creada. Ya puedes iniciar sesion.');
        },
        error: (err) => this.clientAuthError.set(this.readError(err, 'No se pudo crear la cuenta.'))
      });
  }

  confirmLogout(): void {
    if (window.confirm('Estas seguro que quieres cerrar sesion?')) {
      this.logout();
    }
  }

  logout(): void {
    localStorage.removeItem('saga_token');
    localStorage.removeItem('saga_role');
    localStorage.removeItem('saga_username');
    localStorage.removeItem('saga_idcliente');
    this.token.set('');
    this.role.set('');
    this.username.set('');
    this.idcliente.set(null);
    this.clientes.set([]);
    this.productos.set([]);
    this.productSaleCounts.set({});
    this.ventas.set([]);
    this.misVentas.set([]);
    this.sagaLogs.set([]);
    this.cart.set([]);
    this.receiptCart.set([]);
    this.selectedReceipt.set(null);
    this.lastSaga.set(null);
    this.adminTab.set('resumen');
    this.clientTab.set('tienda');
    this.showAdminLogin.set(false);
    this.actingAsClient.set(false);
    this.clearMessages();
    this.clearAuthMessages();
  }

  loadAdminDashboard(clearExistingMessages = true): void {
    if (clearExistingMessages) {
      this.clearMessages();
    }
    this.loading.set(true);

    Promise.all([
      this.safeRequest(this.http.get<Cliente[] | { value: Cliente[] }>('/api/clientes')),
      this.safeRequest(this.http.get<Producto[] | { value: Producto[] }>('/api/productos')),
      this.safeRequest(this.http.get<Venta[] | { value: Venta[] }>('/api/ventas')),
      this.safeRequest(this.http.get<SagaLog[] | { value: SagaLog[] }>('/api/ventas/saga-logs'))
    ])
      .then(async ([clientes, productos, ventas, sagaLogs]) => {
        let firstError: unknown = null;

        if (clientes.ok) {
          this.clientes.set(this.asArray<Cliente>(clientes.value));
        } else {
          firstError = firstError || clientes.error;
        }

        if (productos.ok) {
          const productosList = this.asArray<Producto>(productos.value);
          this.productos.set(productosList);
          await this.loadProductSaleCounts(productosList);
        } else {
          firstError = firstError || productos.error;
        }

        if (ventas.ok) {
          this.ventas.set(this.asArray<Venta>(ventas.value));
        } else {
          firstError = firstError || ventas.error;
        }

        if (sagaLogs.ok) {
          this.sagaLogs.set(this.sortSagaLogs(this.asArray<SagaLog>(sagaLogs.value)));
        } else {
          firstError = firstError || sagaLogs.error;
        }

        this.ensureDefaultSelections();
        if (firstError) {
          this.error.set(this.readError(firstError, 'No se pudieron cargar todos los datos de administracion.'));
        }
      })
      .finally(() => this.loading.set(false));
  }

  loadSagaLogs(clearExistingMessages = true): void {
    if (clearExistingMessages) {
      this.clearMessages();
    }
    this.loading.set(true);

    firstValueFrom(this.http.get<SagaLog[] | { value: SagaLog[] }>('/api/ventas/saga-logs'))
      .then((logs) => this.sagaLogs.set(this.sortSagaLogs(this.asArray<SagaLog>(logs))))
      .catch((err) => this.error.set(this.readError(err, 'No se pudieron cargar los Saga logs.')))
      .finally(() => this.loading.set(false));
  }

  private async loadProductSaleCounts(productos = this.productos()): Promise<void> {
    const entries = await Promise.all(productos.map(async (producto) => {
      try {
        const count = await firstValueFrom(this.http.get<number>(`/api/ventas/producto/${producto.idproducto}/conteo`));
        return [producto.idproducto, Number(count || 0)] as const;
      } catch {
        return [producto.idproducto, 1] as const;
      }
    }));

    this.productSaleCounts.set(Object.fromEntries(entries));
  }
  loadClientStore(clearExistingMessages = true): void {
    if (clearExistingMessages) {
      this.clearMessages();
    }
    this.loading.set(true);

    Promise.all([
      firstValueFrom(this.http.get<Producto[] | { value: Producto[] }>('/api/productos')),
      firstValueFrom(this.http.get<Venta[] | { value: Venta[] }>('/api/ventas/mis-ventas'))
    ])
      .then(([productos, ventas]) => {
        this.productos.set(this.asArray<Producto>(productos));
        this.misVentas.set(this.asArray<Venta>(ventas));
        this.ensureDefaultSelections();
      })
      .catch((err) => this.error.set(this.readError(err, 'No se pudo cargar tu tienda.')))
      .finally(() => this.loading.set(false));
  }

  createClientSale(producto?: Producto): void {
    if (producto) {
      this.addToCart(producto, this.productQuantities[producto.idproducto] || 1);
      return;
    }

    const selected = this.selectedClientProducto();
    if (selected) {
      this.addToCart(selected, Number(this.clientBuyForm.cantidad || 1));
    }
  }

  addToCart(producto: Producto, cantidad = 1): void {
    this.clearMessages();
    const safeQuantity = Math.max(1, Number(cantidad || 1));
    const current = [...this.cart()];
    const existing = current.find((item) => item.producto.idproducto === producto.idproducto);

    if (existing) {
      existing.cantidad = safeQuantity;
    } else {
      current.push({ producto, cantidad: safeQuantity });
    }

    this.cart.set(current);
    this.success.set('Carrito actualizado.');
  }

  updateCartItem(producto: Producto, cantidad: number): void {
    const safeQuantity = Math.max(1, Number(cantidad || 1));
    this.cart.set(this.cart().map((item) =>
      item.producto.idproducto === producto.idproducto ? { ...item, cantidad: safeQuantity } : item
    ));
  }

  removeCartItem(producto: Producto): void {
    this.cart.set(this.cart().filter((item) => item.producto.idproducto !== producto.idproducto));
  }

  checkoutCart(): void {
    this.clearMessages();

    if (!this.cart().length) {
      this.error.set('Agrega al menos un producto al carrito.');
      return;
    }

    this.actionLoading.set(true);
    this.lastSaga.set(null);

    const purchasedItems = this.cart().map((item) => ({ ...item }));
    const payload = {
      items: this.cart().map((item) => ({
        idproducto: item.producto.idproducto,
        cantidad: item.cantidad
      }))
    };

    this.http.post<SagaResponse>('/api/ventas/saga/carrito/cliente', payload)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.lastSaga.set(response);
          this.receiptCart.set(purchasedItems);
          this.cart.set([]);
          this.success.set(response.mensaje || 'Compra realizada correctamente.');
          this.loadClientStore(false);
          if (this.isAdmin()) {
            this.loadAdminDashboard(false);
          }
        },
        error: (err) => {
          this.success.set('');
          this.error.set(this.readClientCheckoutError(err));
          this.loadClientStore(false);
          if (this.isAdmin()) {
            this.loadAdminDashboard(false);
          }
        }
      });
  }

  viewPurchaseReceipt(group: PurchaseGroup): void {
    const receiptItems = group.ventas.map((venta) => {
      const product = this.productos().find((item) => item.idproducto === venta.idproducto);
      const unitPrice = venta.cantidad ? Number(venta.total ?? 0) / venta.cantidad : product?.precio || 0;

      return {
        producto: product || {
          idproducto: venta.idproducto,
          nombre: `Producto ${venta.idproducto}`,
          precio: unitPrice,
          stock: 0
        },
        cantidad: venta.cantidad
      };
    });

    this.selectedReceipt.set(group);
    this.receiptCart.set(receiptItems);
    this.lastSaga.set({
      sagaId: group.sagaId,
      estado: group.estado || 'REGISTRADA',
      mensaje: 'Compra registrada correctamente.',
      ventas: group.ventas,
      total: group.total
    });
  }

  closeReceipt(): void {
    this.lastSaga.set(null);
    this.receiptCart.set([]);
    this.selectedReceipt.set(null);
  }

  showAdminPanel(): void {
    this.actingAsClient.set(false);
    this.loadAdminDashboard();
  }

  showClientStore(): void {
    this.actingAsClient.set(true);
    this.clientTab.set('tienda');
    this.loadClientStore();
  }

  createAdminSale(): void {
    this.runAdminSaga(false);
  }

  simulateAdminCompensationError(): void {
    this.runAdminSaga(true);
  }

  private runAdminSaga(simularFalloDespuesDescuento: boolean): void {
    this.clearMessages();
    this.actionLoading.set(true);
    this.lastSaga.set(null);

    const payload = {
      idcliente: Number(this.adminSaleForm.idcliente),
      idproducto: Number(this.adminSaleForm.idproducto),
      cantidad: Number(this.adminSaleForm.cantidad)
    };
    const url = simularFalloDespuesDescuento
      ? '/api/ventas/saga?simularFalloDespuesDescuento=true'
      : '/api/ventas/saga';

    this.http.post<SagaResponse>(url, payload)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.lastSaga.set(response);
          this.success.set(response.mensaje || (simularFalloDespuesDescuento ? 'Prueba de compensacion Saga ejecutada.' : 'Saga administrativa completada.'));
          this.loadAdminDashboard();
        },
        error: (err) => {
          this.error.set(this.readSagaError(err, simularFalloDespuesDescuento ? 'No se pudo completar tu compra. Intenta nuevamente.' : 'La Saga fallo de forma controlada.'));
          this.loadAdminDashboard();
        }
      });
  }

  saveProducto(): void {
    this.clearMessages();
    this.actionLoading.set(true);

    const payload = {
      nombre: this.productForm.nombre,
      precio: Number(this.productForm.precio),
      stock: Number(this.productForm.stock),
      estado: this.productForm.estado ? 'A' : 'I'
    };

    const request = this.productForm.idproducto
      ? this.http.put<Producto>(`/api/productos/${this.productForm.idproducto}`, payload)
      : this.http.post<Producto>('/api/productos', payload);

    request.pipe(finalize(() => this.actionLoading.set(false))).subscribe({
      next: () => {
        this.success.set(this.productForm.idproducto ? 'Producto actualizado.' : 'Producto creado.');
        this.closeProductoForm();
        this.loadAdminDashboard();
      },
      error: (err) => this.error.set(this.readError(err, 'No se pudo guardar el producto.'))
    });
  }

  editProducto(producto: Producto): void {
    this.productForm = {
      idproducto: producto.idproducto,
      nombre: producto.nombre,
      precio: Number(producto.precio || 0),
      stock: Number(producto.stock || 0),
      estado: this.isProductoActive(producto)
    };
    this.adminTab.set('productos');
    this.showProductForm.set(true);
    this.clearMessages();
  }

  deactivateProducto(producto: Producto): void {
    this.clearMessages();

    if (!this.isProductoActive(producto)) {
      this.success.set('El producto ya esta inactivo.');
      return;
    }

    this.actionLoading.set(true);

    const payload = {
      nombre: producto.nombre,
      precio: Number(producto.precio || 0),
      stock: Number(producto.stock || 0),
      estado: 'I'
    };

    this.http.put<Producto>(`/api/productos/${producto.idproducto}`, payload)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: () => {
          this.success.set('Producto desactivado correctamente.');
          this.loadAdminDashboard();
          this.loadClientStore();
        },
        error: (err) => this.error.set(this.readError(err, 'No se pudo desactivar el producto.'))
      });
  }

  activateProducto(producto: Producto): void {
    this.clearMessages();

    if (this.isProductoActive(producto)) {
      this.success.set('El producto ya esta activo.');
      return;
    }

    this.actionLoading.set(true);

    const payload = {
      nombre: producto.nombre,
      precio: Number(producto.precio || 0),
      stock: Number(producto.stock || 0),
      estado: 'A'
    };

    this.http.put<Producto>(`/api/productos/${producto.idproducto}`, payload)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: () => {
          this.success.set('Producto activado correctamente.');
          this.loadAdminDashboard();
          this.loadClientStore();
        },
        error: (err) => this.error.set(this.readError(err, 'No se pudo activar el producto.'))
      });
  }
  deleteProducto(producto: Producto): void {
    this.clearMessages();

    if (!this.canDeleteProducto(producto)) {
      this.error.set('No se puede eliminar el producto porque ya tiene ventas registradas. Puedes editarlo o desactivarlo.');
      return;
    }

    this.actionLoading.set(true);

    this.http.delete(`/api/productos/${producto.idproducto}`)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: () => {
          this.success.set('Producto eliminado correctamente.');
          this.loadAdminDashboard();
          this.loadClientStore();
        },
        error: (err) => this.error.set(this.readSagaError(err, 'No se pudo eliminar el producto.'))
      });
  }
  saveCliente(): void {
    this.clearMessages();
    this.actionLoading.set(true);

    if (!this.clienteForm.idcliente) {
      const registerPayload = {
        username: this.clienteForm.username,
        password: this.clienteForm.password,
        nombres: this.clienteForm.nombres,
        apellidos: this.clienteForm.apellidos,
        correo: this.clienteForm.correo,
        telefono: this.clienteForm.telefono
      };

      this.http.post<RegisterResponse>('/api/auth/register-cliente', registerPayload)
        .pipe(finalize(() => this.actionLoading.set(false)))
        .subscribe({
          next: () => {
            this.success.set('Cuenta cliente creada con usuario para iniciar sesion.');
            this.resetClienteForm();
            this.loadAdminDashboard();
          },
          error: (err) => this.error.set(this.readError(err, 'No se pudo crear la cuenta cliente.'))
        });
      return;
    }

    const payload = {
      nombres: this.clienteForm.nombres,
      apellidos: this.clienteForm.apellidos,
      correo: this.clienteForm.correo,
      telefono: this.clienteForm.telefono,
      estado: this.clienteForm.estado ? 'A' : 'I'
    };

    if (this.isClienteFormProtected()) {
      payload.estado = 'A';
    }

    this.http.put<Cliente>(`/api/clientes/${this.clienteForm.idcliente}`, payload)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: () => {
          this.success.set('Cliente actualizado.');
          this.resetClienteForm();
          this.loadAdminDashboard();
        },
        error: (err) => this.error.set(this.readError(err, 'No se pudo guardar el cliente.'))
      });
  }
  editCliente(cliente: Cliente): void {
    this.clienteForm = {
      idcliente: cliente.idcliente,
      username: '',
      password: '',
      nombres: cliente.nombres,
      apellidos: cliente.apellidos,
      correo: cliente.correo,
      telefono: cliente.telefono,
      estado: this.isClienteActive(cliente)
    };
    this.adminTab.set('clientes');
    this.clearMessages();
  }

  deactivateCliente(cliente: Cliente): void {
    this.clearMessages();

    if (this.isProtectedAdminCliente(cliente)) {
      this.error.set('El cliente administrador no se puede desactivar.');
      return;
    }

    if (!this.isClienteActive(cliente)) {
      this.success.set('El cliente ya esta inactivo.');
      return;
    }

    this.actionLoading.set(true);

    this.http.delete<Cliente>(`/api/clientes/${cliente.idcliente}`)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: () => {
          this.success.set('Cliente desactivado correctamente.');
          this.loadAdminDashboard();
        },
        error: (err) => this.error.set(this.readError(err, 'No se pudo desactivar el cliente.'))
      });
  }
  openProductoForm(): void {
    this.resetProductoForm();
    this.showProductForm.set(true);
    this.clearMessages();
  }

  closeProductoForm(): void {
    this.resetProductoForm();
    this.showProductForm.set(false);
  }

  resetProductoForm(): void {
    this.productForm = {
      idproducto: null,
      nombre: '',
      precio: 0,
      stock: 0,
      estado: true
    };
  }

  resetClienteForm(): void {
    this.clienteForm = {
      idcliente: null,
      username: '',
      password: '',
      nombres: '',
      apellidos: '',
      correo: '',
      telefono: '',
      estado: true
    };
  }

  simulateAdminStockError(): void {
    this.adminSaleForm.cantidad = 999999;
    this.createAdminSale();
  }

  selectAdminTab(tab: AdminTab): void {
    this.adminTab.set(tab);
    if (tab === 'logs') {
      this.loadSagaLogs();
      return;
    }
    this.clearMessages();
  }

  selectClientTab(tab: ClientTab): void {
    this.clientTab.set(tab);
    this.clearMessages();
  }

  trackById(_index: number, item: Trackable): number {
    if ('id' in item) {
      return item.id;
    }
    if ('idventa' in item) {
      return item.idventa;
    }
    if ('idproducto' in item) {
      return item.idproducto;
    }
    return item.idcliente;
  }

  private doLogin(credentials: { username: string; password: string }, context: 'client' | 'admin'): void {
    this.clearAuthMessages();
    this.actionLoading.set(true);

    this.http.post<LoginResponse>('/api/auth/login', credentials)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.storeSession(response, credentials.username);
          if (context === 'client') {
            this.clientAuthSuccess.set('Sesion iniciada correctamente.');
          }

          if (this.isAdmin()) {
            this.showAdminLogin.set(false);
            this.actingAsClient.set(false);
            this.loadAdminDashboard();
            return;
          }

          if (this.isClient()) {
            this.loadClientStore();
            return;
          }

          this.setAuthError(context, 'Rol no reconocido por el frontend.');
        },
        error: (err) => this.setAuthError(context, this.readError(err, 'No se pudo iniciar sesion.'))
      });
  }

  private storeSession(response: LoginResponse, fallbackUsername: string): void {
    const role = response.rol || 'ROLE_CLIENTE';
    const idcliente = response.idcliente ?? null;
    const username = response.username || fallbackUsername;

    localStorage.setItem('saga_token', response.token);
    localStorage.setItem('saga_role', role);
    localStorage.setItem('saga_username', username);

    if (idcliente) {
      localStorage.setItem('saga_idcliente', String(idcliente));
    } else {
      localStorage.removeItem('saga_idcliente');
    }

    this.token.set(response.token);
    this.role.set(role);
    this.username.set(username);
    this.idcliente.set(idcliente);
  }

  private ensureDefaultSelections(): void {
    const firstProduct = this.productos()[0];
    const firstCliente = this.clientes()[0];

    if (firstProduct && !this.productos().some((producto) => producto.idproducto === Number(this.clientBuyForm.idproducto))) {
      this.clientBuyForm.idproducto = firstProduct.idproducto;
    }
    if (firstProduct && !this.productos().some((producto) => producto.idproducto === Number(this.adminSaleForm.idproducto))) {
      this.adminSaleForm.idproducto = firstProduct.idproducto;
    }
    if (firstCliente && !this.clientes().some((cliente) => cliente.idcliente === Number(this.adminSaleForm.idcliente))) {
      this.adminSaleForm.idcliente = firstCliente.idcliente;
    }
  }

  isClienteActive(cliente: Cliente): boolean {
    return cliente.estado === true || cliente.estado === 'A' || cliente.estado === 'ACTIVO';
  }

  isProductoActive(producto: Producto): boolean {
    return producto.estado === undefined || producto.estado === null || producto.estado === true || producto.estado === 'A' || producto.estado === 'ACTIVO';
  }

  productoEstadoLabel(producto: Producto): string {
    return this.isProductoActive(producto) ? 'Activo' : 'Inactivo';
  }

  productoVentaCount(producto: Producto): number {
    return this.productSaleCounts()[producto.idproducto] ?? 1;
  }

  canDeleteProducto(producto: Producto): boolean {
    return this.productoVentaCount(producto) === 0;
  }

  isProtectedAdminCliente(cliente: Pick<Cliente, 'idcliente' | 'correo'>): boolean {
    return Number(cliente.idcliente) === 1 || cliente.correo === 'admin@saga.local';
  }

  isClienteFormProtected(): boolean {
    return Boolean(this.clienteForm.idcliente) && this.isProtectedAdminCliente({
      idcliente: Number(this.clienteForm.idcliente),
      correo: this.clienteForm.correo
    });
  }

  clienteEstadoLabel(cliente: Cliente): string {
    return this.isClienteActive(cliente) ? 'Activo' : 'Inactivo';
  }

  clearMessages(): void {
    this.error.set('');
    this.success.set('');
  }

  clearAuthMessages(): void {
    this.clientAuthError.set('');
    this.clientAuthSuccess.set('');
    this.adminAuthError.set('');
  }

  private setAuthError(context: 'client' | 'admin', message: string): void {
    if (context === 'admin') {
      this.adminAuthError.set(message);
      return;
    }
    this.clientAuthError.set(message);
  }

  private safeRequest<T>(request: Observable<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    return firstValueFrom(request)
      .then((value) => ({ ok: true, value }) as const)
      .catch((error) => ({ ok: false, error }) as const);
  }

  private asArray<T>(value: T[] | { value?: T[]; content?: T[]; data?: T[]; items?: T[] } | undefined | null): T[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && 'value' in value && Array.isArray(value.value)) {
      return value.value;
    }
    if (value && 'content' in value && Array.isArray(value.content)) {
      return value.content;
    }
    if (value && 'data' in value && Array.isArray(value.data)) {
      return value.data;
    }
    if (value && 'items' in value && Array.isArray(value.items)) {
      return value.items;
    }
    return [];
  }

  private sortSagaLogs(logs: SagaLog[]): SagaLog[] {
    return [...logs].sort((a, b) =>
      this.localFechaValue(b.fecha) - this.localFechaValue(a.fecha)
    );
  }

  private readSagaError(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body?.message) {
        return body.message;
      }
      if (typeof body === 'string' && body.trim()) {
        return body;
      }
      if (err.status === 0) {
        return 'No hay conexion con el backend.';
      }
    }
    return fallback;
  }

  formatFechaLocal(fecha?: string | null): string {
    if (!fecha) {
      return '';
    }

    const tieneZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(fecha);
    if (tieneZona) {
      const parsed = new Date(fecha);
      if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat('es-PE', {
          timeZone: 'America/Lima',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(parsed);
      }
    }

    const limpia = fecha.split('.')[0];
    const [datePart, timePart] = limpia.split('T');
    if (!datePart || !timePart) {
      return fecha;
    }

    const [year, month, day] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    if (!year || !month || !day || !hour || !minute) {
      return fecha;
    }

    return day + '/' + month + '/' + year + ' ' + hour + ':' + minute;
  }

  private localFechaValue(fecha?: string | null): number {
    if (!fecha) {
      return 0;
    }

    const tieneZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(fecha);
    if (tieneZona) {
      const parsed = new Date(fecha);
      if (!Number.isNaN(parsed.getTime())) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Lima',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }).formatToParts(parsed);
        const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';

        return Number(value('year') + value('month') + value('day') + value('hour') + value('minute') + value('second'));
      }
    }

    const limpia = fecha.split('.')[0];

    const [datePart, timePart = '00:00:00'] = limpia.split('T');
    const [year, month, day] = datePart.split('-').map((value) => Number(value));
    const [hour = 0, minute = 0, second = 0] = timePart.split(':').map((value) => Number(value));

    if (!year || !month || !day) {
      return 0;
    }

    return Number(
      String(year) +
      String(month).padStart(2, '0') +
      String(day).padStart(2, '0') +
      String(hour).padStart(2, '0') +
      String(minute).padStart(2, '0') +
      String(second).padStart(2, '0')
    );
  }
  private readClientCheckoutError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      return body?.message || body?.mensaje || 'No se pudo completar tu compra. Intenta nuevamente.';
    }
    return 'No se pudo completar tu compra. Intenta nuevamente.';
  }
  private readError(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (typeof body === 'string' && body.trim()) {
        return `${fallback} ${body}`;
      }
      if (body?.message) {
        return `${fallback} ${body.message}`;
      }
      if (body?.error) {
        return `${fallback} ${body.error}`;
      }
      if (err.status === 0) {
        return `${fallback} No hay conexion con el backend.`;
      }
      return `${fallback} Codigo HTTP ${err.status}.`;
    }
    return fallback;
  }
}
