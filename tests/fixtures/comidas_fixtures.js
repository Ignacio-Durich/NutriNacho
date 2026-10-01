/**
 * Mock Fixtures for Supabase `comidas` Table
 */

const { NACHO_ID, MAMA_ID } = require('./metas_fixtures');

function getLogicalDateString(dayOffset = 0) {
    const d = new Date();
    d.setHours(d.getHours() - 4); // UTC-4 logical date
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().split('T')[0];
}

function createMeal(options = {}) {
    const dayOffset = options.dayOffset !== undefined ? options.dayOffset : 0;
    const dateStr = options.date || getLogicalDateString(dayOffset);
    return {
        id: options.id || Math.floor(Math.random() * 100000),
        usuario_id: options.usuario_id || NACHO_ID,
        comida: options.comida || 'Almuerzo estándar',
        calorias: options.calorias !== undefined ? options.calorias : 600,
        proteina_g: options.proteina_g !== undefined ? options.proteina_g : 45,
        carbohidratos_g: options.carbohidratos_g !== undefined ? options.carbohidratos_g : 60,
        grasas_g: options.grasas_g !== undefined ? options.grasas_g : 18,
        fecha: `${dateStr}T12:00:00+00:00`
    };
}

/**
 * Nacho full day hitting goals: 2300 cal, 185g prot, 220g carb, 75g fat
 */
function createNachoPerfectDay(dayOffset = 0) {
    return [
        createMeal({ dayOffset, comida: 'Desayuno proteico (huevos y avena)', calorias: 550, proteina_g: 45, carbohidratos_g: 50, grasas_g: 18 }),
        createMeal({ dayOffset, comida: 'Almuerzo: Pechuga con arroz y palta', calorias: 750, proteina_g: 65, carbohidratos_g: 70, grasas_g: 22 }),
        createMeal({ dayOffset, comida: 'Merienda: Yogur griego con frutas', calorias: 350, proteina_g: 30, carbohidratos_g: 40, grasas_g: 8 }),
        createMeal({ dayOffset, comida: 'Cena: Bife de lomo con batatas y ensalada', calorias: 650, proteina_g: 45, carbohidratos_g: 60, grasas_g: 27 })
    ];
}

/**
 * Nacho 14-day history with known period deltas:
 * Current 7 days (offsets -6 to 0): Avg ~2300 cal, ~185g prot
 * Previous 7 days (offsets -13 to -7): Avg ~2000 cal, ~150g prot
 */
function createNachoTwoPeriodSet() {
    const meals = [];
    // Previous period (-13 to -7)
    for (let offset = -13; offset <= -7; offset++) {
        meals.push(createMeal({
            dayOffset: offset,
            comida: `Día anterior ${offset}`,
            calorias: 2000,
            proteina_g: 150,
            carbohidratos_g: 200,
            grasas_g: 65
        }));
    }
    // Current period (-6 to 0)
    for (let offset = -6; offset <= 0; offset++) {
        meals.push(createMeal({
            dayOffset: offset,
            comida: `Día actual ${offset}`,
            calorias: 2300,
            proteina_g: 185,
            carbohidratos_g: 220,
            grasas_g: 75
        }));
    }
    return meals;
}

/**
 * Mamá gap days dataset:
 * Meals logged only on offsets -6, -5, -3.
 * Offsets -4, -2, -1, 0 have ZERO meals.
 */
function createMamaGapDaysSet() {
    return [
        createMeal({ usuario_id: MAMA_ID, dayOffset: -6, comida: 'Tostadas con queso y café', calorias: 400, proteina_g: 20, carbohidratos_g: 45, grasas_g: 14 }),
        createMeal({ usuario_id: MAMA_ID, dayOffset: -6, comida: 'Pescado con verduras al vapor', calorias: 600, proteina_g: 45, carbohidratos_g: 35, grasas_g: 18 }),
        createMeal({ usuario_id: MAMA_ID, dayOffset: -5, comida: 'Ensalada completa con atún', calorias: 750, proteina_g: 50, carbohidratos_g: 40, grasas_g: 25 }),
        createMeal({ usuario_id: MAMA_ID, dayOffset: -3, comida: 'Pollo al horno con calabaza', calorias: 850, proteina_g: 60, carbohidratos_g: 50, grasas_g: 28 })
    ];
}

/**
 * Special character meals for CSV verification:
 * Commas, double quotes, Spanish accents (á, é, í, ó, ú, ñ)
 */
function createSpecialCharacterMeals(dayOffset = 0) {
    return [
        createMeal({ dayOffset, comida: 'Milanesa con papas fritas, limón y ensalada', calorias: 850, proteina_g: 45, carbohidratos_g: 80, grasas_g: 35 }),
        createMeal({ dayOffset, comida: 'Café "Cortado" con medialunas de manteca', calorias: 420, proteina_g: 8, carbohidratos_g: 55, grasas_g: 18 }),
        createMeal({ dayOffset, comida: 'Ñoquis caseros con salsa bolognesa y queso rallado', calorias: 920, proteina_g: 38, carbohidratos_g: 110, grasas_g: 32 })
    ];
}

module.exports = {
    getLogicalDateString,
    createMeal,
    createNachoPerfectDay,
    createNachoTwoPeriodSet,
    createMamaGapDaysSet,
    createSpecialCharacterMeals
};
