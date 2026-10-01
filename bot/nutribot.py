import os
import telebot
from dotenv import load_dotenv
from google import genai
from supabase import create_client
import requests
from PIL import Image
import io
import json
import time
import re
from datetime import datetime, timezone, timedelta
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton

# --- 1. Credentials (loaded from .env, never hardcoded) ---
load_dotenv()

def _require_env(name):
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing environment variable {name}. Copy .env.example to .env and fill it in.")
    return value

TELEGRAM_TOKEN = _require_env('TELEGRAM_TOKEN')
GEMINI_API_KEY = _require_env('GEMINI_API_KEY')
SUPABASE_URL = _require_env('SUPABASE_URL')
SUPABASE_KEY = _require_env('SUPABASE_KEY')
DASHBOARD_URL = os.getenv('DASHBOARD_URL')  # optional: public URL of the web dashboard

# --- 2. Inicialización ---
bot = telebot.TeleBot(TELEGRAM_TOKEN)
gemini = genai.Client(api_key=GEMINI_API_KEY)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
MODELOS_FALLBACK = [
    'gemini-3.8-flash',       # 1° Más nuevo y preciso (5 RPM, 20 RPD)
    'gemini-3.7-flash',       # 2° Segundo más nuevo (5 RPM, 20 RPD)
    'gemini-3.6-flash',       # 3° Tu modelo original, probado (5 RPM, 20 RPD)
    'gemini-3.5-flash-lite',  # 4° Rápido con MUCHA cuota (15 RPM, 500 RPD)
    'gemini-3.1-flash-lite',  # 5° Último recurso, cuota enorme (15 RPM, 500 RPD)
]

# --- MULTI-USER SETTINGS AND MEMORY ---
# Allowed Telegram users and their nutrition goals live in users.json (git-ignored).
# See users.example.json for the expected format.
USERS_FILE = os.getenv('USERS_FILE', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'users.json'))
try:
    with open(USERS_FILE, encoding='utf-8') as f:
        USUARIOS_PERMITIDOS = {int(uid): profile for uid, profile in json.load(f).items()}
except FileNotFoundError:
    raise SystemExit(f"{USERS_FILE} not found. Copy users.example.json to users.json and fill it in.")

# Diccionario para guardar el estado de cada usuario por separado
memoria_usuarios = {}
estado_metas = {} # Para el asistente guiado de metas

# --- 3. Funciones Auxiliares ---
def obtener_meta_actual(user_id):
    try:
        # Busca la ultima meta de ESTE usuario en Supabase
        respuesta = supabase.table('metas').select('*').eq('usuario_id', user_id).order('fecha_creacion', desc=True).limit(1).execute()
        if respuesta.data:
            return respuesta.data[0]
    except Exception as e:
        print(f"Error buscando metas en Supabase: {e}")
    # Fallback a las hardcodeadas si falla la db o si todavia no cargo ninguna
    if user_id in USUARIOS_PERMITIDOS:
        u = USUARIOS_PERMITIDOS[user_id]
        return {'id': None, 'calorias': u['META_CALORIAS'], 'proteina_g': u['META_PROTEINAS'], 'carbohidratos_g': u['META_CARBOHIDRATOS'], 'grasas_g': u['META_GRASAS']}
    return None

def iniciar_memoria_usuario(user_id):
    if user_id not in memoria_usuarios:
        memoria_usuarios[user_id] = {"ultimo_registro_id": None, "ultimo_registro_datos": None}

def es_error_limite(error):
    error_str = str(error).lower()
    return any(palabra in error_str for palabra in ['rate limit', 'quota', 'resource exhausted', '429', 'too many requests', 'overloaded', '503', 'unavailable', 'high demand'])

# Modelos que acaban de devolver error de cuota o sobrecarga se saltean un rato,
# para no gastar un pedido fallido (y esperar) en cada mensaje.
modelos_en_espera = {}  # nombre del modelo -> instante (monotonic) hasta el que se saltea
ESPERA_LIMITE = 60        # segundos, si el error no dice cuánto esperar
ESPERA_CUOTA_DIARIA = 3600  # segundos, si la cuota agotada es la diaria

def _ahora():
    return time.monotonic()

def espera_para_error(error):
    mensaje = str(error)
    reintento = re.search(r"retryDelay['\"]?:\s*['\"]?(\d+(?:\.\d+)?)s", mensaje)
    if reintento:
        return min(max(float(reintento.group(1)), 5), ESPERA_CUOTA_DIARIA)
    if 'perday' in mensaje.lower():
        return ESPERA_CUOTA_DIARIA
    return ESPERA_LIMITE

def llamar_gemini(prompt_o_contenido, intentos_por_modelo=2, espera_base=2):
    ultimo_error = None
    ahora = _ahora()
    disponibles = [m for m in MODELOS_FALLBACK if modelos_en_espera.get(m, 0) <= ahora]
    # Si todos están en pausa, se intenta igual con la cadena completa
    for nombre_modelo in (disponibles or MODELOS_FALLBACK):
        espera = espera_base
        for intento in range(1, intentos_por_modelo + 1):
            try:
                texto = gemini.models.generate_content(model=nombre_modelo, contents=prompt_o_contenido).text
                modelos_en_espera.pop(nombre_modelo, None)
                return texto
            except Exception as e:
                ultimo_error = e
                if es_error_limite(e):
                    modelos_en_espera[nombre_modelo] = _ahora() + espera_para_error(e)
                    break
                elif isinstance(e, (ConnectionError, TimeoutError)) or any(p in str(e).lower() for p in ['connection', 'timeout', 'reset']):
                    if intento < intentos_por_modelo:
                        time.sleep(espera)
                        espera *= 2
                    else:
                        break
                else:
                    raise
    raise Exception(f"Todos los modelos fallaron. Último error: {ultimo_error}")

def obtener_base_conocimiento():
    try:
        respuesta = supabase.table('alimentos_frecuentes').select('*').execute()
        datos = respuesta.data
        if not datos: return ""
            
        reglas = "REGLA ESTRICTA: Si el usuario menciona o la imagen contiene alguno de los siguientes alimentos, DEBES usar obligatoriamente estos valores:\n"
        for item in datos:
            reglas += f"- {item['nombre']} ({item['porcion']}): {item['calorias']} kcal, {item['proteina_g']}g proteina, {item['carbohidratos_g']}g carbohidratos, {item['grasas_g']}g grasas.\n"
        return reglas
    except Exception as e:
        return ""

def obtener_consumo_hoy(user_id):
    hoy_logico = (datetime.now(timezone.utc) - timedelta(hours=4)).strftime('%Y-%m-%d')
    try:
        # Filtramos en Supabase SOLO los platos de este usuario
        respuesta = supabase.table('comidas').select('*').eq('usuario_id', user_id).order('id', desc=True).limit(50).execute()
        datos = respuesta.data
        
        cal_hoy = prot_hoy = carb_hoy = grasas_hoy = 0
        for item in datos:
            fecha_str = item.get('fecha', '')
            if not fecha_str: continue
                
            fecha_limpia = fecha_str.split('.')[0].replace('Z', '')
            fecha_utc = datetime.fromisoformat(fecha_limpia)
            fecha_logica_item = (fecha_utc - timedelta(hours=4)).strftime('%Y-%m-%d')
            
            if fecha_logica_item == hoy_logico:
                cal_hoy += item.get('calorias', 0)
                prot_hoy += item.get('proteina_g', 0)
                carb_hoy += item.get('carbohidratos_g', 0)
                grasas_hoy += item.get('grasas_g', 0)
        return cal_hoy, prot_hoy, carb_hoy, grasas_hoy
    except Exception as e:
        return 0, 0, 0, 0

def enviar_resumen(message, comida_nombre, cal, prot, carb, grasas, es_correccion=False):
    user_id = message.from_user.id
    cal_hoy, prot_hoy, carb_hoy, grasas_hoy = obtener_consumo_hoy(user_id)
    
    meta = obtener_meta_actual(user_id)
    cal_restantes = max(0, meta["calorias"] - cal_hoy)
    prot_restantes = max(0, meta["proteina_g"] - prot_hoy)
    carb_restantes = max(0, meta["carbohidratos_g"] - carb_hoy)
    grasas_restantes = max(0, meta["grasas_g"] - grasas_hoy)
    
    metas = USUARIOS_PERMITIDOS[user_id] # solo para sacar el nombre
    
    titulo = "📝 ¡Registro Corregido!" if es_correccion else "✅ ¡Plato guardado!"
    nombre = metas["nombre"]
    
    msg = (f"{titulo}\n"
           f"👤 Usuario: {nombre}\n"
           f"🍽 {comida_nombre}\n\n"
           f"📊 MACROS DEL PLATO:\n"
           f"🔥 Calorías: {cal} kcal\n"
           f"🥩 Proteínas: {prot}g\n"
           f"🍞 Carbos: {carb}g\n"
           f"🥑 Grasas: {grasas}g\n\n"
           f"🎯 PROGRESO DE HOY:\n"
           f"Llevás: {cal_hoy} kcal | {prot_hoy}g prot | {carb_hoy}g carb | {grasas_hoy}g grasas\n"
           f"Faltan: {cal_restantes} kcal | {prot_restantes}g prot | {carb_restantes}g carb | {grasas_restantes}g grasas")
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("📋 Menú", callback_data="mostrar_menu"))
           
    bot.reply_to(message, msg, reply_markup=markup)

def limpiar_decimales(datos_json):
    for macro in ['calorias', 'proteina_g', 'carbohidratos_g', 'grasas_g']:
        if macro in datos_json:
            datos_json[macro] = int(round(float(datos_json[macro])))
    return datos_json

def buscar_en_base_local(texto):
    try:
        respuesta = supabase.table('alimentos_frecuentes').select('*').execute()
        datos = respuesta.data
        if not datos: return None
        texto_lower = texto.lower().strip()
        for item in datos:
            nombre_lower = item['nombre'].lower()
            if nombre_lower in texto_lower or texto_lower in nombre_lower:
                match = re.match(r'^(\d+\.?\d*)\s+', texto_lower)
                multiplicador = float(match.group(1)) if match else 1
                return {
                    'comida': item['nombre'] if multiplicador == 1 else f"{int(multiplicador)}x {item['nombre']}",
                    'calorias': int(item['calorias'] * multiplicador),
                    'proteina_g': int(item['proteina_g'] * multiplicador),
                    'carbohidratos_g': int(item['carbohidratos_g'] * multiplicador),
                    'grasas_g': int(item['grasas_g'] * multiplicador)
                }
        return None
    except: return None

def corregir_sin_ia(texto, datos_originales):
    texto_lower = texto.lower().strip()
    datos = dict(datos_originales)
    
    if 'mitad' in texto_lower:
        for macro in ['calorias', 'proteina_g', 'carbohidratos_g', 'grasas_g']:
            if macro in datos: datos[macro] = int(datos[macro] / 2)
        return datos
    if 'doble' in texto_lower:
        for macro in ['calorias', 'proteina_g', 'carbohidratos_g', 'grasas_g']:
            if macro in datos: datos[macro] = int(datos[macro] * 2)
        return datos
    if 'tercio' in texto_lower:
        for macro in ['calorias', 'proteina_g', 'carbohidratos_g', 'grasas_g']:
            if macro in datos: datos[macro] = int(datos[macro] / 3)
        return datos
    
    match_cal = re.search(r'(\d+)\s*(kcal|calorias|calorías)', texto_lower)
    if match_cal: datos['calorias'] = int(match_cal.group(1)); return datos
    match_prot = re.search(r'(\d+)\s*g?\s*(de\s+)?(prote[ií]na|prot)', texto_lower)
    if match_prot: datos['proteina_g'] = int(match_prot.group(1)); return datos
    match_mult = re.search(r'(?:multiplicar\s+)?por\s+(\d+\.?\d*)', texto_lower)
    if match_mult:
        factor = float(match_mult.group(1))
        for macro in ['calorias', 'proteina_g', 'carbohidratos_g', 'grasas_g']:
            if macro in datos: datos[macro] = int(datos[macro] * factor)
        return datos
    return None

def parsear_json_gemini(respuesta_texto):
    texto = respuesta_texto.replace('```json', '').replace('```', '').strip()
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        inicio = texto.find('{')
        fin = texto.rfind('}')
        if inicio != -1 and fin != -1:
            return json.loads(texto[inicio:fin + 1])
        raise ValueError(f"Gemini no devolvió un JSON válido: {texto[:100]}")

# --- 4. Handler 1: Ingreso de Fotos ---
@bot.message_handler(content_types=['photo'])
def procesar_foto(message):
    user_id = message.from_user.id
    if user_id not in USUARIOS_PERMITIDOS:
        bot.reply_to(message, "⛔ Acceso denegado. Este bot es privado.")
        return

    iniciar_memoria_usuario(user_id)
    bot.reply_to(message, f"Hola {USUARIOS_PERMITIDOS[user_id]['nombre']}, analizando tu comida y fecha... ⏳")
    
    try:
        descripcion = message.caption if message.caption else ""
        file_info = bot.get_file(message.photo[-1].file_id)
        img = Image.open(io.BytesIO(requests.get(f'https://api.telegram.org/file/bot{TELEGRAM_TOKEN}/{file_info.file_path}').content))
        
        hoy_logico = (datetime.now(timezone.utc) - timedelta(hours=4)).strftime('%Y-%m-%d')
        base_dinamica = obtener_base_conocimiento()
        
        prompt = f"""
        Sos un nutricionista. Analizá la imagen considerando esta nota: "{descripcion}".
        FECHA ACTUAL: {hoy_logico}. Si la nota indica explícitamente que la comida es de ayer o de un día anterior, calculá esa fecha. Si no dice nada, usá la FECHA ACTUAL.
        
        {base_dinamica}
        
        Devolvé SOLO un JSON válido con esta estructura:
        {{"comida": "nombre", "calorias": 0, "proteina_g": 0, "carbohidratos_g": 0, "grasas_g": 0, "fecha_logica": "YYYY-MM-DD"}}
        """
        
        datos = parsear_json_gemini(llamar_gemini([prompt, img]))
        datos = limpiar_decimales(datos)
        
        fecha_asignada = datos.pop('fecha_logica', hoy_logico)
        datos['fecha'] = f"{fecha_asignada} 12:00:00+00:00"
        datos['usuario_id'] = user_id # Vinculamos el plato al usuario
        
        meta_actual = obtener_meta_actual(user_id)
        if meta_actual['id']: datos['meta_id'] = meta_actual['id']
        
        respuesta = supabase.table('comidas').insert(datos).execute()
        memoria_usuarios[user_id]['ultimo_registro_id'] = respuesta.data[0]['id']
        memoria_usuarios[user_id]['ultimo_registro_datos'] = datos
        
        enviar_resumen(message, datos['comida'], datos['calorias'], datos['proteina_g'], datos['carbohidratos_g'], datos['grasas_g'])
        
    except Exception as e:
        bot.reply_to(message, f"Error en la foto: {e}")

# --- 5. Handler 2: Enrutador de Texto (Ingreso Manual o Edición) ---
@bot.message_handler(content_types=['text'], func=lambda m: not m.text.startswith('/'))
def procesar_texto(message):
    user_id = message.from_user.id
    if user_id not in USUARIOS_PERMITIDOS:
        bot.reply_to(message, "⛔ Acceso denegado. Este bot es privado.")
        return

    iniciar_memoria_usuario(user_id)
    es_correccion = any(palabra in message.text.lower() for palabra in ['corregir', 'cambiar', 'mitad', 'agregar', 'era', 'en realidad'])

    if es_correccion:
        if not memoria_usuarios[user_id]['ultimo_registro_id']:
            bot.reply_to(message, "No tengo ninguna comida reciente tuya registrada para corregir.")
            return

        try:
            nuevos_datos = corregir_sin_ia(message.text, memoria_usuarios[user_id]['ultimo_registro_datos'])
            
            if nuevos_datos:
                bot.reply_to(message, "Corrigiendo sin IA... ⚡")
            else:
                bot.reply_to(message, "Procesando corrección con IA... ⏳")
                prompt = f"""
                El usuario registró esta comida: {json.dumps(memoria_usuarios[user_id]['ultimo_registro_datos'])}.
                Corrección del usuario: "{message.text}".
                Ajustá los valores del JSON original. Devolvé SOLO el JSON actualizado.
                """
                nuevos_datos = parsear_json_gemini(llamar_gemini(prompt))
            
            nuevos_datos = limpiar_decimales(nuevos_datos)
            
            supabase.table('comidas').update(nuevos_datos).eq('id', memoria_usuarios[user_id]['ultimo_registro_id']).execute()
            memoria_usuarios[user_id]['ultimo_registro_datos'] = nuevos_datos
            
            enviar_resumen(message, nuevos_datos['comida'], nuevos_datos['calorias'], nuevos_datos['proteina_g'], nuevos_datos['carbohidratos_g'], nuevos_datos['grasas_g'], es_correccion=True)
        except Exception as e:
            bot.reply_to(message, f"Error al intentar corregir: {e}")
            
    else:
        try:
            hoy_logico = (datetime.now(timezone.utc) - timedelta(hours=4)).strftime('%Y-%m-%d')
            datos_local = buscar_en_base_local(message.text)
            
            if datos_local:
                bot.reply_to(message, "Encontrado en tu base de datos... ⚡")
                datos = datos_local
            else:
                bot.reply_to(message, "Analizando con IA... ⏳")
                base_dinamica = obtener_base_conocimiento()

                prompt = f"""
                Sos un nutricionista. Analizá esta comida ingresada por texto: "{message.text}".
                FECHA ACTUAL: {hoy_logico}. Si el texto indica explícitamente que la comida es de ayer o de un día anterior, calculá esa fecha. Si no dice nada, usá la FECHA ACTUAL.
                {base_dinamica}
                Devolvé SOLO un JSON válido:
                {{"comida": "nombre", "calorias": 0, "proteina_g": 0, "carbohidratos_g": 0, "grasas_g": 0, "fecha_logica": "YYYY-MM-DD"}}
                """
                datos = parsear_json_gemini(llamar_gemini(prompt))
            
            datos = limpiar_decimales(datos)
            fecha_asignada = datos.pop('fecha_logica', hoy_logico)
            datos['fecha'] = f"{fecha_asignada} 12:00:00+00:00"
            datos['usuario_id'] = user_id # Vinculamos el plato
            
            meta_actual = obtener_meta_actual(user_id)
            if meta_actual['id']: datos['meta_id'] = meta_actual['id']
            
            respuesta = supabase.table('comidas').insert(datos).execute()
            memoria_usuarios[user_id]['ultimo_registro_id'] = respuesta.data[0]['id']
            memoria_usuarios[user_id]['ultimo_registro_datos'] = datos
            
            enviar_resumen(message, datos['comida'], datos['calorias'], datos['proteina_g'], datos['carbohidratos_g'], datos['grasas_g'])
        except Exception as e:
            bot.reply_to(message, f"Error en el ingreso manual: {e}")

# --- 6. Menú Interactivo (Base de Conocimiento compartida) ---
@bot.message_handler(commands=['alimentos'])
def menu_alimentos(message):
    if message.from_user.id not in USUARIOS_PERMITIDOS: return
        
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("📋 Ver lista", callback_data="ver_alimentos"),
               InlineKeyboardButton("➕ Agregar", callback_data="agregar_alimento"))
    bot.reply_to(message, "⚙️ GESTOR DE ALIMENTOS FRECUENTES:", reply_markup=markup)

@bot.callback_query_handler(func=lambda call: True)
def manejar_botones(call):
    user_id = call.from_user.id
    # Seguridad: solo usuarios permitidos pueden usar los botones (excepto mostrar_menu que es inofensivo)
    if user_id not in USUARIOS_PERMITIDOS and call.data != "mostrar_menu":
        bot.answer_callback_query(call.id, "⛔ Acceso denegado.")
        return

    if call.data == "ver_alimentos":
        lista = obtener_base_conocimiento()
        bot.send_message(call.message.chat.id, lista if lista else "Base vacía.")
    elif call.data == "agregar_alimento":
        msg = bot.send_message(call.message.chat.id, "Formato:\nNombre, Porción, Kcal, Prot, Carb, Grasas\n(Ejemplo: Leche sachet, 1 vaso, 110, 8, 12, 3)")
        bot.register_next_step_handler(msg, guardar_nuevo_alimento)
    elif call.data.startswith("pagina_borrar_"):
        offset = int(call.data.replace("pagina_borrar_", ""))
        mostrar_pagina_borrar(call.message.chat.id, user_id, offset, message_id=call.message.message_id)
    elif call.data.startswith("confirmar_borrar_"):
        comida_id = int(call.data.replace("confirmar_borrar_", ""))
        resp = supabase.table('comidas').select('*').eq('id', comida_id).eq('usuario_id', user_id).execute()
        if resp.data:
            markup = InlineKeyboardMarkup()
            markup.add(InlineKeyboardButton("✅ Sí, borrar", callback_data=f"borrar_si_{comida_id}"),
                       InlineKeyboardButton("❌ Cancelar", callback_data="cancelar_borrar"))
            bot.edit_message_text(f"⚠️ ¿Borrar *{resp.data[0]['comida']}*?", call.message.chat.id, call.message.message_id, reply_markup=markup, parse_mode="Markdown")
        else:
            bot.answer_callback_query(call.id, "No existe o no es tuya.")
    elif call.data.startswith("borrar_si_"):
        comida_id = int(call.data.replace("borrar_si_", ""))
        supabase.table('comidas').delete().eq('id', comida_id).eq('usuario_id', user_id).execute()
        bot.edit_message_text("✅ Eliminada.", call.message.chat.id, call.message.message_id)
    elif call.data == "cancelar_borrar":
        bot.edit_message_text("🚫 Cancelado.", call.message.chat.id, call.message.message_id)
    elif call.data == "mostrar_menu":
        nombre = USUARIOS_PERMITIDOS.get(user_id, {}).get('nombre', 'Usuario')
        msg = (f"📋 *MENÚ DE {nombre.upper()}*\n\n"
               "/menu — 📋 Ver este menú\n"
           "/consulta — 🧑‍⚕️ Nutricionista Virtual\n"
           "/metas — 🎯 Actualizar Metas Diarias\n"
               "/stats — 📈 Estadísticas semanales\n"
               "/alimentos — ⚙️ Gestionar base de conocimiento\n"
               "/borrar — 🗑 Eliminar comidas\n"
               "/dashboard — 📊 Dashboard web\n\n"
               "💡 *Para registrar:* Mandá una foto o escribí el plato.")
        bot.send_message(call.message.chat.id, msg, parse_mode="Markdown")

def guardar_nuevo_alimento(message):
    try:
        datos = message.text.split(',')
        if len(datos) != 6:
            bot.reply_to(message, "⛔ Formato incorrecto. Necesito 6 datos separados por comas.")
            return
        nuevo = {"nombre": datos[0].strip(), "porcion": datos[1].strip(), "calorias": int(datos[2].strip()), "proteina_g": int(datos[3].strip()), "carbohidratos_g": int(datos[4].strip()), "grasas_g": int(datos[5].strip())}
        supabase.table('alimentos_frecuentes').insert(nuevo).execute()
        bot.reply_to(message, f"✅ '{nuevo['nombre']}' guardado en la base de conocimiento.")
    except ValueError:
        bot.reply_to(message, "⛔ Error: los valores de macros deben ser números enteros.")
    except Exception as e:
        bot.reply_to(message, f"Error: {e}")

def extraer_dias_consulta(texto):
    prompt = f"""Analiza esta consulta: '{texto}'. ¿Qué rango de tiempo en días está pidiendo analizar el usuario? 
    Devolve SOLO un número entero. Si no menciona tiempo, devolve 7. Máximo 180. 
    Ejemplos: 'último mes' -> 30, 'hace 3 semanas' -> 21, '¿cómo vengo?' -> 7."""
    try:
        resp = gemini.models.generate_content(model='gemini-3.1-flash-lite', contents=prompt)
        match = re.search(r'\d+', resp.text)
        return min(max(int(match.group()), 1), 180) if match else 7
    except:
        return 7

def obtener_consumo_historico(user_id, dias=7):
    fecha_limite = (datetime.now(timezone.utc) - timedelta(hours=4) - timedelta(days=dias)).strftime('%Y-%m-%d')
    try:
        respuesta = supabase.table('comidas').select('*').eq('usuario_id', user_id).gte('fecha', fecha_limite).execute()
        datos = respuesta.data
        if not datos: return 0, 0, 0, 0, 0
        
        dias_set = set()
        c = p = ch = g = 0
        for i in datos:
            if not i.get('fecha'): continue
            try:
                f_log = (datetime.fromisoformat(i['fecha'].split('.')[0].replace('Z','+00:00')) - timedelta(hours=4)).strftime('%Y-%m-%d')
                dias_set.add(f_log)
                c += i.get('calorias',0); p += i.get('proteina_g',0); ch += i.get('carbohidratos_g',0); g += i.get('grasas_g',0)
            except: pass
        d_count = max(1, len(dias_set))
        return int(c/d_count), int(p/d_count), int(ch/d_count), int(g/d_count), d_count
    except: return 0,0,0,0,0

# --- 7. Comando de Estadísticas Semanales ---
@bot.message_handler(commands=['stats'])
def estadisticas_semanales(message):
    user_id = message.from_user.id
    if user_id not in USUARIOS_PERMITIDOS: return
    
    bot.reply_to(message, "📊 Calculando tus promedios... ⏳")
    prom_cal, prom_prot, prom_carb, prom_grasas, d_count = obtener_consumo_historico(user_id, 7)
    
    if d_count == 0:
        bot.reply_to(message, "No hay registros suficientes en los últimos 7 días.")
        return
        
    meta = obtener_meta_actual(user_id)
    nombre = USUARIOS_PERMITIDOS[user_id]['nombre']
    msg = (f"📈 **STATS DE {nombre.upper()} (Últ. {d_count} días)**\n\n"
           f"🔥 Calorías: {prom_cal} kcal / día (Meta: {meta['calorias']})\n"
           f"🥩 Proteínas: {prom_prot}g / día (Meta: {meta['proteina_g']}g)\n"
           f"🍞 Carbos: {prom_carb}g / día (Meta: {meta['carbohidratos_g']}g)\n"
           f"🥑 Grasas: {prom_grasas}g / día (Meta: {meta['grasas_g']}g)")
    bot.reply_to(message, msg, parse_mode="Markdown")

# --- 8. Acceso al Dashboard ---
@bot.message_handler(commands=['dashboard'])
def mandar_dashboard(message):
    if message.from_user.id not in USUARIOS_PERMITIDOS: return
    if not DASHBOARD_URL:
        bot.reply_to(message, "El dashboard no está configurado todavía.")
        return
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("📈 Abrir Dashboard", url=DASHBOARD_URL))
    bot.reply_to(message, "Tus gráficos:", reply_markup=markup)

# --- 9. Borrar Comidas ---
@bot.message_handler(commands=['borrar'])
def borrar_comida(message):
    if message.from_user.id not in USUARIOS_PERMITIDOS: return
    mostrar_pagina_borrar(message.chat.id, message.from_user.id, offset=0)

def mostrar_pagina_borrar(chat_id, user_id, offset=0, message_id=None):
    try:
        # Filtramos por usuario
        respuesta = supabase.table('comidas').select('id, comida, calorias, fecha').eq('usuario_id', user_id).order('fecha', desc=True).range(offset, offset + 9).execute()
        datos = respuesta.data
        if not datos:
            bot.send_message(chat_id, "No hay comidas." if offset==0 else "No hay más.")
            return
            
        markup = InlineKeyboardMarkup()
        texto = f"🗑 *BORRAR COMIDA*:\n\n"
        for i, item in enumerate(datos):
            try:
                f_disp = (datetime.fromisoformat(item['fecha'].split('.')[0].replace('Z','')) - timedelta(hours=4)).strftime('%d/%m %H:%M')
            except: f_disp = '??'
            texto += f"{i+1}. {item['comida']} ({item['calorias']} kcal) - {f_disp}\n"
            markup.add(InlineKeyboardButton(f"❌ {i+1}. {item['comida'][:20]}", callback_data=f"confirmar_borrar_{item['id']}"))
            
        nav = []
        if offset > 0: nav.append(InlineKeyboardButton("⬅️", callback_data=f"pagina_borrar_{offset-10}"))
        if len(datos) == 10: nav.append(InlineKeyboardButton("➡️", callback_data=f"pagina_borrar_{offset+10}"))
        if nav: markup.add(*nav)
        markup.add(InlineKeyboardButton("🚫 Cancelar", callback_data="cancelar_borrar"))
        
        if message_id: bot.edit_message_text(texto, chat_id, message_id, reply_markup=markup, parse_mode="Markdown")
        else: bot.send_message(chat_id, texto, reply_markup=markup, parse_mode="Markdown")
    except Exception as e: bot.send_message(chat_id, f"Error: {e}")

# --- 10. Menú ---
@bot.message_handler(commands=['menu'])
def mostrar_menu(message):
    user_id = message.from_user.id
    if user_id not in USUARIOS_PERMITIDOS: return
    nombre = USUARIOS_PERMITIDOS[user_id]['nombre']
    msg = (f"📋 *MENÚ DE {nombre.upper()}*\n\n"
           "/menu — 📋 Ver este menú\n"
           "/consulta — 🧑‍⚕️ Nutricionista Virtual\n"
           "/metas — 🎯 Actualizar Metas Diarias\n"
           "/stats — 📈 Estadísticas semanales\n"
           "/alimentos — ⚙️ Gestionar base de conocimiento\n"
           "/borrar — 🗑 Eliminar comidas\n"
           "/dashboard — 📊 Dashboard web\n\n"
           "💡 *Para registrar:* Mandá una foto o escribí el plato.")
    bot.reply_to(message, msg, parse_mode="Markdown")


# --- 11. Consulta Nutricionista ---
@bot.message_handler(commands=['consulta'])
def comando_consulta(message):
    if message.from_user.id not in USUARIOS_PERMITIDOS: return
    msg = bot.reply_to(message, "🧑‍⚕️ Soy tu nutricionista virtual.\n¿En qué te puedo ayudar hoy?\n*(Ej: ¿Qué ceno si me faltan 50g de prote con pollo y huevo?)*", parse_mode="Markdown")
    bot.register_next_step_handler(msg, procesar_consulta)

def procesar_consulta(message):
    user_id = message.from_user.id
    msg_status = bot.reply_to(message, "Pensando la mejor respuesta... 🤔")
    
    pregunta = message.text
    dias_a_analizar = extraer_dias_consulta(pregunta)
    bot.edit_message_text(f"Analizando tu consumo de los últimos {dias_a_analizar} días... 🤔", chat_id=message.chat.id, message_id=msg_status.message_id)
    
    meta = obtener_meta_actual(user_id)
    cal_hoy, prot_hoy, carb_hoy, grasas_hoy = obtener_consumo_hoy(user_id)
    cal_rest = meta['calorias'] - cal_hoy
    prot_rest = meta['proteina_g'] - prot_hoy
    carb_rest = meta['carbohidratos_g'] - carb_hoy
    grasas_rest = meta['grasas_g'] - grasas_hoy
    
    prom_cal, prom_prot, prom_carb, prom_grasas, dias_count = obtener_consumo_historico(user_id, dias_a_analizar)
    
    prompt = f"""
    Sos el nutricionista personal del usuario. 
    El usuario te hace esta consulta: "{pregunta}"
    
    Contexto de su DÍA ACTUAL (lo que ya comió hoy y sus metas):
    - Meta diaria: {meta['calorias']} kcal | {meta['proteina_g']}g prot | {meta['carbohidratos_g']}g carb | {meta['grasas_g']}g grasas
    - Consumido hoy: {cal_hoy} kcal | {prot_hoy}g prot | {carb_hoy}g carb | {grasas_hoy}g grasas
    - Diferencia: {cal_rest} kcal | {prot_rest}g prot | {carb_rest}g carb | {grasas_rest}g grasas
      (Negativo significa que ya se pasó).
    
    Contexto TENDENCIA SEMANAL (promedio últimos {dias_count} días):
    - Consumo promedio: {prom_cal} kcal | {prom_prot}g prot | {prom_carb}g carb | {prom_grasas}g grasas
    
    Instrucciones:
    1. Respondé a su consulta de forma práctica y amigable.
    2. Usá los datos semanales si pide balancear días futuros.
    3. Si pide sugerencias de comidas, usá los macros restantes de HOY.
    4. Respondé en texto plano sin bloques de código JSON.
    """
    try:
        respuesta = llamar_gemini(prompt)
        bot.reply_to(message, respuesta, parse_mode="Markdown")
    except Exception as e:
        bot.reply_to(message, f"Error al consultar al nutricionista: {e}")

# --- 12. Asistente de Metas Dinámicas ---
@bot.message_handler(commands=['metas'])
def iniciar_carga_metas(message):
    user_id = message.from_user.id
    if user_id not in USUARIOS_PERMITIDOS: return
    estado_metas[user_id] = {}
    msg = bot.reply_to(message, "🎯 Vamos a configurar tus nuevas metas.\n\n¿Cuántas **Calorías** diarias apuntás a comer? (Ej: 2300)", parse_mode="Markdown")
    bot.register_next_step_handler(msg, paso_calorias)

def paso_calorias(message):
    user_id = message.from_user.id
    try:
        estado_metas[user_id]['calorias'] = int(message.text.strip())
        msg = bot.reply_to(message, "Perfecto. ¿Cuántos gramos de **Proteína**? (Ej: 185)", parse_mode="Markdown")
        bot.register_next_step_handler(msg, paso_proteinas)
    except ValueError:
        msg = bot.reply_to(message, "Ingresá solo números. ¿Cuántas **Calorías** diarias?")
        bot.register_next_step_handler(msg, paso_calorias)

def paso_proteinas(message):
    user_id = message.from_user.id
    try:
        estado_metas[user_id]['proteina_g'] = int(message.text.strip())
        msg = bot.reply_to(message, "Anotado. ¿Cuántos gramos de **Carbohidratos**? (Ej: 220)", parse_mode="Markdown")
        bot.register_next_step_handler(msg, paso_carbos)
    except ValueError:
        msg = bot.reply_to(message, "Solo números. ¿Cuántos gramos de **Proteína**?")
        bot.register_next_step_handler(msg, paso_proteinas)

def paso_carbos(message):
    user_id = message.from_user.id
    try:
        estado_metas[user_id]['carbohidratos_g'] = int(message.text.strip())
        msg = bot.reply_to(message, "Casi terminamos. ¿Cuántos gramos de **Grasas**? (Ej: 75)", parse_mode="Markdown")
        bot.register_next_step_handler(msg, paso_grasas)
    except ValueError:
        msg = bot.reply_to(message, "Solo números. ¿Cuántos gramos de **Carbohidratos**?")
        bot.register_next_step_handler(msg, paso_carbos)

def paso_grasas(message):
    user_id = message.from_user.id
    try:
        estado_metas[user_id]['grasas_g'] = int(message.text.strip())
        nueva_meta = {
            "usuario_id": user_id,
            "calorias": estado_metas[user_id]['calorias'],
            "proteina_g": estado_metas[user_id]['proteina_g'],
            "carbohidratos_g": estado_metas[user_id]['carbohidratos_g'],
            "grasas_g": estado_metas[user_id]['grasas_g']
        }
        supabase.table('metas').insert(nueva_meta).execute()
        bot.reply_to(message, f"✅ ¡Nuevas metas guardadas exitosamente!\n\n🔥 Calorías: {nueva_meta['calorias']}\n🥩 Proteína: {nueva_meta['proteina_g']}g\n🍞 Carbos: {nueva_meta['carbohidratos_g']}g\n🥑 Grasas: {nueva_meta['grasas_g']}g")
    except ValueError:
        msg = bot.reply_to(message, "Solo números. ¿Cuántos gramos de **Grasas**?")
        bot.register_next_step_handler(msg, paso_grasas)
    except Exception as e:
        bot.reply_to(message, f"Error al guardar la meta en la BD: {e}")

mensaje_actualizacion = """
🚀 **¡NutriBot Actualizado! (Versión 4.1 Multiusuario)** 🚀

¡Hola! Se instalaron nuevas mejoras en el sistema:

1️⃣ **Metas Dinámicas Propias**: Ahora cada usuario puede actualizar sus objetivos usando el comando /metas. El historial de metas se guarda para que los análisis futuros sigan siendo exactos.
2️⃣ **Nutricionista Virtual**: Con el comando /consulta pueden hacer preguntas abiertas (ej: *"¿Qué ceno si me faltan 50g de proteína?"*). El bot mira su historial para responder.
3️⃣ **Análisis Flexible**: Al nutricionista le pueden pedir rangos de tiempo (ej: *"cómo vengo este último mes"*) y lo analiza.
4️⃣ **Sistema Anti-Caídas**: Se agregó una cadena inteligente de 5 modelos de IA distintos (Gemini 3.8, 3.7, 3.6, etc.). Si uno se satura, pasa automáticamente al siguiente para que nunca se queden sin respuesta.
"""
def main():
    for u_id in USUARIOS_PERMITIDOS.keys():
        try: bot.send_message(u_id, mensaje_actualizacion, parse_mode="Markdown")
        except: pass

    print(f"Bot V4.1 MULTIUSUARIO corriendo con: {' -> '.join(MODELOS_FALLBACK)} 🚀")
    bot.infinity_polling(timeout=60, long_polling_timeout=30)

if __name__ == "__main__":
    main()
