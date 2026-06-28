import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, firstValueFrom } from 'rxjs';

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
  descripcion?: string;
  precio: number;
  stock: number;
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
    descripcion: '',
    precio: 0,
    stock: 0
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
      new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime()
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
    this.productos().filter((producto) => Number(producto.stock || 0) > 0)
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

  loadAdminDashboard(): void {
    this.clearMessages();
    this.loading.set(true);

    Promise.all([
      firstValueFrom(this.http.get<Cliente[] | { value: Cliente[] }>('/api/clientes')),
      firstValueFrom(this.http.get<Producto[] | { value: Producto[] }>('/api/productos')),
      firstValueFrom(this.http.get<Venta[] | { value: Venta[] }>('/api/ventas')),
      firstValueFrom(this.http.get<SagaLog[] | { value: SagaLog[] }>('/api/ventas/saga-logs'))
    ])
      .then(([clientes, productos, ventas, sagaLogs]) => {
        this.clientes.set(this.asArray<Cliente>(clientes));
        this.productos.set(this.asArray<Producto>(productos));
        this.ventas.set(this.asArray<Venta>(ventas));
        this.sagaLogs.set(this.asArray<SagaLog>(sagaLogs));
        this.ensureDefaultSelections();
      })
      .catch((err) => this.error.set(this.readError(err, 'No se pudieron cargar los datos de administracion.')))
      .finally(() => this.loading.set(false));
  }

  loadClientStore(): void {
    this.clearMessages();
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
          this.loadClientStore();
          if (this.isAdmin()) {
            this.loadAdminDashboard();
          }
        },
        error: (err) => {
          this.error.set(this.readClientCheckoutError(err));
          this.loadClientStore();
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
    this.clearMessages();
    this.actionLoading.set(true);
    this.lastSaga.set(null);

    const payload = {
      idcliente: Number(this.adminSaleForm.idcliente),
      idproducto: Number(this.adminSaleForm.idproducto),
      cantidad: Number(this.adminSaleForm.cantidad)
    };

    this.http.post<SagaResponse>('/api/ventas/saga', payload)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.lastSaga.set(response);
          this.success.set(response.mensaje || 'Saga administrativa completada.');
          this.loadAdminDashboard();
        },
        error: (err) => {
          this.error.set(this.readError(err, 'La Saga fallo de forma controlada.'));
          this.loadAdminDashboard();
        }
      });
  }

  saveProducto(): void {
    this.clearMessages();
    this.actionLoading.set(true);

    const payload = {
      nombre: this.productForm.nombre,
      descripcion: this.productForm.descripcion,
      precio: Number(this.productForm.precio),
      stock: Number(this.productForm.stock)
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
      descripcion: producto.descripcion || '',
      precio: Number(producto.precio || 0),
      stock: Number(producto.stock || 0)
    };
    this.adminTab.set('productos');
    this.showProductForm.set(true);
    this.clearMessages();
  }

  deleteProducto(producto: Producto): void {
    this.clearMessages();
    this.actionLoading.set(true);

    this.http.delete(`/api/productos/${producto.idproducto}`)
      .pipe(finalize(() => this.actionLoading.set(false)))
      .subscribe({
        next: () => {
          this.success.set('Producto eliminado.');
          this.loadAdminDashboard();
        },
        error: (err) => this.error.set(this.readError(err, 'No se pudo eliminar el producto.'))
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
      descripcion: '',
      precio: 0,
      stock: 0
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

  private asArray<T>(value: T[] | { value: T[] } | undefined | null): T[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && 'value' in value && Array.isArray(value.value)) {
      return value.value;
    }
    return [];
  }

  private readClientCheckoutError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (err.status === 409) {
        return body?.message || 'No se pudo completar tu compra. Intenta nuevamente.';
      }
      return 'No se pudo completar la compra. Intenta nuevamente.';
    }
    return 'No se pudo completar la compra. Intenta nuevamente.';
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
