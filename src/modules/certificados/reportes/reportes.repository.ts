import { pool, getEmpresaId } from '../shared/db.helper';

/** Rango de fechas (YYYY-MM-DD) inclusivo. */
export interface RangoFechas { desde: string; hasta: string; }

export interface ReporteResumen {
  certificados_emitidos: number;   // creados en el rango (cualquier estado vigente)
  certificados_vigentes: number;   // estado vigente
  certificados_anulados: number;   // estado anulado
  inscripciones_nuevas: number;    // inscripciones creadas en el rango
  estudiantes_nuevos: number;      // participantes registrados en el rango
  aprobados: number;               // inscripciones del rango ya aprobadas
  desaprobados: number;            // inscripciones del rango desaprobadas
  tasa_aprobacion: number;         // % aprobados sobre inscripciones del rango (0-100)
  creditos_consumidos: number;     // créditos gastados en emisiones del rango
  programas_activos: number;       // programas activos hoy
  aulas_activas: number;           // aulas activas hoy
}

export interface FilaPorPrograma { programa: string; emitidos: number; }
export interface FilaPorMes { mes: string; emitidos: number; }   // mes = 'YYYY-MM'

/** Embudo de conversión: inscritos → aprobados → certificados del periodo. */
export interface Embudo { inscritos: number; aprobados: number; emitidos: number; }

/** Comparativo del periodo vs el periodo anterior de igual duración. */
export interface Comparativo {
  rango_anterior: RangoFechas;
  certificados:  { actual: number; anterior: number; pct: number };
  inscripciones: { actual: number; anterior: number; pct: number };
}

export interface AprobacionPrograma { programa: string; inscritos: number; aprobados: number; tasa: number; }
export interface Productividad { operador: string; emitidos: number; }

export interface FilaCertificado {
  codigo: string;
  alumno: string;
  documento: string;
  programa: string;
  aula: string;
  fecha_emision: string;
  estado: string;
}

export const reportesRepo = {
  /** Tarjetas de resumen del periodo + totales vigentes. */
  async resumen(tenantSlug: string, r: RangoFechas): Promise<ReporteResumen> {
    const empresaId = await getEmpresaId(tenantSlug);

    const [cert] = await pool().query<any[]>(
      `SELECT
         COUNT(*)                                   AS emitidos,
         SUM(CASE WHEN estado_id = 1 THEN 1 ELSE 0 END) AS vigentes,
         SUM(CASE WHEN estado_id = 2 THEN 1 ELSE 0 END) AS anulados
       FROM certificados
       WHERE empresa_id = ? AND fecha_emision BETWEEN ? AND ?`,
      [empresaId, r.desde, r.hasta],
    );
    const [insc] = await pool().query<any[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN estado_id = 3 THEN 1 ELSE 0 END) AS aprobados,
         SUM(CASE WHEN estado_id = 4 THEN 1 ELSE 0 END) AS desaprobados
       FROM inscripciones
       WHERE empresa_id = ? AND fecha_inscripcion BETWEEN ? AND ?`,
      [empresaId, r.desde, r.hasta],
    );
    const [estu] = await pool().query<any[]>(
      `SELECT COUNT(*) AS total FROM participantes
        WHERE empresa_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
      [empresaId, r.desde, r.hasta],
    );
    const [cred] = await pool().query<any[]>(
      `SELECT COALESCE(-SUM(cantidad), 0) AS total FROM creditos_movimientos
        WHERE empresa_id = ? AND tipo = 'consumo' AND DATE(created_at) BETWEEN ? AND ?`,
      [empresaId, r.desde, r.hasta],
    );
    const [prog] = await pool().query<any[]>(
      'SELECT COUNT(*) AS total FROM programas WHERE empresa_id = ? AND activo = 1', [empresaId],
    );
    const [aula] = await pool().query<any[]>(
      'SELECT COUNT(*) AS total FROM grupos_programas WHERE empresa_id = ? AND activo = 1', [empresaId],
    );

    const c = (cert as any[])[0] ?? {};
    const ins = (insc as any[])[0] ?? {};
    const totalInsc = Number(ins.total ?? 0);
    const aprobados = Number(ins.aprobados ?? 0);
    return {
      certificados_emitidos: Number(c.emitidos ?? 0),
      certificados_vigentes: Number(c.vigentes ?? 0),
      certificados_anulados: Number(c.anulados ?? 0),
      inscripciones_nuevas:  totalInsc,
      estudiantes_nuevos:    Number((estu as any[])[0]?.total ?? 0),
      aprobados,
      desaprobados:          Number(ins.desaprobados ?? 0),
      tasa_aprobacion:       totalInsc > 0 ? Math.round((aprobados / totalInsc) * 1000) / 10 : 0,
      creditos_consumidos:   Number((cred as any[])[0]?.total ?? 0),
      programas_activos:     Number((prog as any[])[0]?.total ?? 0),
      aulas_activas:         Number((aula as any[])[0]?.total ?? 0),
    };
  },

  /** Tendencia: certificados emitidos por mes en el periodo (para el gráfico de barras). */
  async tendenciaMensual(tenantSlug: string, r: RangoFechas): Promise<FilaPorMes[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT DATE_FORMAT(fecha_emision, '%Y-%m') AS mes, COUNT(*) AS emitidos
         FROM certificados
        WHERE empresa_id = ? AND fecha_emision BETWEEN ? AND ?
        GROUP BY mes ORDER BY mes`,
      [empresaId, r.desde, r.hasta],
    );
    return (rows as any[]).map(x => ({ mes: x.mes, emitidos: Number(x.emitidos) }));
  },

  /** Certificados emitidos por programa en el periodo (para el desglose/gráfico). */
  async porPrograma(tenantSlug: string, r: RangoFechas): Promise<FilaPorPrograma[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT prog.nombre AS programa, COUNT(*) AS emitidos
         FROM certificados c
         JOIN inscripciones i    ON i.id = c.inscripcion_id
         JOIN grupos_programas g ON g.id = i.grupo_id
         JOIN programas prog     ON prog.id = g.programa_id
        WHERE c.empresa_id = ? AND c.fecha_emision BETWEEN ? AND ?
        GROUP BY prog.id, prog.nombre
        ORDER BY emitidos DESC`,
      [empresaId, r.desde, r.hasta],
    );
    return (rows as any[]).map(x => ({ programa: x.programa, emitidos: Number(x.emitidos) }));
  },

  /** Detalle de certificados emitidos en el periodo (para la tabla + Excel). */
  async certificadosDetalle(tenantSlug: string, r: RangoFechas): Promise<FilaCertificado[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT c.codigo_unico AS codigo,
              CONCAT(p.nombres,' ',p.apellidos) AS alumno,
              p.numero_documento AS documento,
              prog.nombre AS programa,
              g.nombre_grupo AS aula,
              c.fecha_emision,
              ec.nombre AS estado
         FROM certificados c
         JOIN inscripciones i    ON i.id = c.inscripcion_id
         JOIN participantes p    ON p.id = i.participante_id
         JOIN grupos_programas g ON g.id = i.grupo_id
         JOIN programas prog     ON prog.id = g.programa_id
         JOIN estado_certificado ec ON ec.id = c.estado_id
        WHERE c.empresa_id = ? AND c.fecha_emision BETWEEN ? AND ?
        ORDER BY c.fecha_emision DESC, c.id DESC`,
      [empresaId, r.desde, r.hasta],
    );
    return (rows as any[]).map(x => ({
      codigo: x.codigo,
      alumno: x.alumno,
      documento: x.documento ?? '',
      programa: x.programa,
      aula: x.aula,
      fecha_emision: typeof x.fecha_emision === 'string' ? x.fecha_emision.slice(0, 10) : new Date(x.fecha_emision).toISOString().slice(0, 10),
      estado: x.estado,
    }));
  },

  /** Embudo: de las inscripciones del periodo, cuántas se aprobaron; y certificados emitidos. */
  async embudo(tenantSlug: string, r: RangoFechas): Promise<Embudo> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [ins] = await pool().query<any[]>(
      `SELECT COUNT(*) AS inscritos,
              SUM(CASE WHEN estado_id = 3 THEN 1 ELSE 0 END) AS aprobados
         FROM inscripciones
        WHERE empresa_id = ? AND fecha_inscripcion BETWEEN ? AND ?`,
      [empresaId, r.desde, r.hasta],
    );
    const [cer] = await pool().query<any[]>(
      'SELECT COUNT(*) AS emitidos FROM certificados WHERE empresa_id = ? AND fecha_emision BETWEEN ? AND ?',
      [empresaId, r.desde, r.hasta],
    );
    return {
      inscritos: Number((ins as any[])[0]?.inscritos ?? 0),
      aprobados: Number((ins as any[])[0]?.aprobados ?? 0),
      emitidos:  Number((cer as any[])[0]?.emitidos ?? 0),
    };
  },

  /** Comparativo del periodo vs el periodo anterior (misma duración, justo antes). */
  async comparativo(tenantSlug: string, r: RangoFechas): Promise<Comparativo> {
    const empresaId = await getEmpresaId(tenantSlug);
    const dia = 24 * 60 * 60 * 1000;
    const desde = new Date(`${r.desde}T00:00:00`);
    const hasta = new Date(`${r.hasta}T00:00:00`);
    const dias = Math.round((hasta.getTime() - desde.getTime()) / dia) + 1;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const prevHasta = new Date(desde.getTime() - dia);
    const prevDesde = new Date(prevHasta.getTime() - (dias - 1) * dia);
    const rangoAnterior: RangoFechas = { desde: iso(prevDesde), hasta: iso(prevHasta) };

    const contar = async (rg: RangoFechas) => {
      const [c] = await pool().query<any[]>(
        'SELECT COUNT(*) AS n FROM certificados WHERE empresa_id = ? AND fecha_emision BETWEEN ? AND ?',
        [empresaId, rg.desde, rg.hasta],
      );
      const [i] = await pool().query<any[]>(
        'SELECT COUNT(*) AS n FROM inscripciones WHERE empresa_id = ? AND fecha_inscripcion BETWEEN ? AND ?',
        [empresaId, rg.desde, rg.hasta],
      );
      return { cert: Number((c as any[])[0]?.n ?? 0), insc: Number((i as any[])[0]?.n ?? 0) };
    };
    const [act, ant] = await Promise.all([contar(r), contar(rangoAnterior)]);
    const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : (a > 0 ? 100 : 0));

    return {
      rango_anterior: rangoAnterior,
      certificados:  { actual: act.cert, anterior: ant.cert, pct: pct(act.cert, ant.cert) },
      inscripciones: { actual: act.insc, anterior: ant.insc, pct: pct(act.insc, ant.insc) },
    };
  },

  /** Tasa de aprobación por programa (de las inscripciones del periodo). */
  async aprobacionPorPrograma(tenantSlug: string, r: RangoFechas): Promise<AprobacionPrograma[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT prog.nombre AS programa,
              COUNT(*) AS inscritos,
              SUM(CASE WHEN i.estado_id = 3 THEN 1 ELSE 0 END) AS aprobados
         FROM inscripciones i
         JOIN grupos_programas g ON g.id = i.grupo_id
         JOIN programas prog     ON prog.id = g.programa_id
        WHERE i.empresa_id = ? AND i.fecha_inscripcion BETWEEN ? AND ?
        GROUP BY prog.id, prog.nombre
        ORDER BY inscritos DESC`,
      [empresaId, r.desde, r.hasta],
    );
    return (rows as any[]).map(x => {
      const inscritos = Number(x.inscritos);
      const aprobados = Number(x.aprobados);
      return { programa: x.programa, inscritos, aprobados, tasa: inscritos > 0 ? Math.round((aprobados / inscritos) * 1000) / 10 : 0 };
    });
  },

  /** Productividad: certificados emitidos por operador (user_crea_id) en el periodo. */
  async productividad(tenantSlug: string, r: RangoFechas): Promise<Productividad[]> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT TRIM(CONCAT(COALESCE(u.nombres,''),' ',COALESCE(u.apellidos,''))) AS operador,
              COUNT(*) AS emitidos
         FROM certificados c
         LEFT JOIN usuarios u ON u.id = c.user_crea_id
        WHERE c.empresa_id = ? AND c.fecha_emision BETWEEN ? AND ?
        GROUP BY c.user_crea_id
        ORDER BY emitidos DESC`,
      [empresaId, r.desde, r.hasta],
    );
    return (rows as any[]).map(x => ({ operador: (x.operador && x.operador.trim()) || 'Sin registrar', emitidos: Number(x.emitidos) }));
  },
};
