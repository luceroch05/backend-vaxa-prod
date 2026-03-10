/**
 * Módulos que un tenant puede tener habilitados o no.
 */
export interface TenantModules {
  dashboard: boolean;
  pacientes: boolean;
  citas: boolean;
  terapeutas: boolean;
  facturacion: boolean;
}

/**
 * Configuración de un tenant (empresa).
 */
export interface TenantConfig {
  id: string;
  name: string;
  primaryColor?: string;
  activo?: boolean;
  hasLogin?: boolean;
  modules: TenantModules;
  customModules?: string[];
}

export type TenantModuleKey = keyof TenantModules;
