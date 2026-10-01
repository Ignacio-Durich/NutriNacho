/**
 * Mock Fixtures for Supabase `metas` Table
 */

const NACHO_ID = 111111111;
const MAMA_ID = 222222222;

const METAS_FIXTURES = {
    // Dynamic goal updates for Nacho
    nachoActive: {
        id: 101,
        usuario_id: NACHO_ID,
        calorias: 2450,
        proteina_g: 195,
        carbohidratos_g: 215,
        grasas_g: 80,
        fecha_creacion: '2026-09-28T18:00:00+00:00'
    },
    // Older goal row for Nacho (should be ignored due to order DESC limit 1)
    nachoOlder: {
        id: 99,
        usuario_id: NACHO_ID,
        calorias: 2100,
        proteina_g: 170,
        carbohidratos_g: 200,
        grasas_g: 70,
        fecha_creacion: '2026-09-01T12:00:00+00:00'
    },
    // Dynamic goal updates for Mamá
    mamaActive: {
        id: 102,
        usuario_id: MAMA_ID,
        calorias: 1720,
        proteina_g: 135,
        carbohidratos_g: 165,
        grasas_g: 58,
        fecha_creacion: '2026-09-27T14:30:00+00:00'
    },
    // Partial row with null values (for fallback testing)
    partialNacho: {
        id: 105,
        usuario_id: NACHO_ID,
        calorias: 2500,
        proteina_g: null,
        carbohidratos_g: 230,
        grasas_g: null,
        fecha_creacion: '2026-09-29T10:00:00+00:00'
    }
};

module.exports = {
    NACHO_ID,
    MAMA_ID,
    METAS_FIXTURES
};
