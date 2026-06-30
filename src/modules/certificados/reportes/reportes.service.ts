import { reportesRepo, type RangoFechas } from './reportes.repository';

export const reportesService = {
  resumen:               (t: string, r: RangoFechas) => reportesRepo.resumen(t, r),
  porPrograma:           (t: string, r: RangoFechas) => reportesRepo.porPrograma(t, r),
  tendenciaMensual:      (t: string, r: RangoFechas) => reportesRepo.tendenciaMensual(t, r),
  certificadosDetalle:   (t: string, r: RangoFechas) => reportesRepo.certificadosDetalle(t, r),
  embudo:                (t: string, r: RangoFechas) => reportesRepo.embudo(t, r),
  comparativo:           (t: string, r: RangoFechas) => reportesRepo.comparativo(t, r),
  aprobacionPorPrograma: (t: string, r: RangoFechas) => reportesRepo.aprobacionPorPrograma(t, r),
  productividad:         (t: string, r: RangoFechas) => reportesRepo.productividad(t, r),
};
