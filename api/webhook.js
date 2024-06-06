// Require our Telegram helper package
const TelegramBot = require('node-telegram-bot-api');
const RentryClient = require("rentry-client");
const CryptoJS = require('crypto-js');

const diaSemana = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]; // Array con días de la semana
const mes = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]; // Array con los meses

module.exports = async (request, response) => {

    /////////////// rentry methods ///////////////////////

    function encryptData(data) {
        return CryptoJS.AES.encrypt(JSON.stringify(data), process.env.ENCRYPTION_KEY).toString();
    }

    function decryptData(cipher) {
        const bytes = CryptoJS.AES.decrypt(cipher, process.env.ENCRYPTION_KEY);
        return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    }

    async function updatePost (paste_content) {
        try {
            const res = await RentryClient.edit({
                id: 'smash-malaga-bot',
                token: 'smash-malaga-bot',
                data: paste_content,
            });
            console.log(res);
        } catch (e) {
            console.log(e.message, 'Error while updating post. Please try again');
        }
    }

    async function loadData () {
        const res = await RentryClient.raw('smash-malaga-bot');
        return res.content;
    }

    ////////////////////////// rentry methods end ///////////////////////////////

    
    function fechaProximaQuedada(dias) {  // Función que genera las fechas para cada indicador de /proximaQuedada
        const fechas = [];
        for (let d of dias) {
            let q = diaSemana.indexOf(d);
            const nextFecha = calcularNumeroDia(q);   // Función que calcula los días y el mes de la quedada. Comprueba si te pasas del día máximo de del mes y salta al siguiente, reiniciando al día 1.

            if (nextFecha && !fechas.find(x => x.diaSemana === diaSemana[q])) {
                fechas.push({ diaSemana: diaSemana[q], numeroDia: nextFecha.dia, mes: mes[nextFecha.mes] });
            }
        }

        fechas.sort((a, b) => {
            return diaSemana.indexOf(a.diaSemana) - diaSemana.indexOf(b.diaSemana);
        })

        // Devolvemos las fechas futuras
        let textoFechas = '';
        for (let f of fechas) {
            textoFechas += `${f.diaSemana}, ${f.numeroDia} de ${f.mes}\n`;
        }
        return {fechas: fechas, textoFechas: textoFechas};
    }

    function calcularNumeroDia(weekDay) {
        const hoy = new Date();
        let numToday = hoy.getDay() - 1;

        if (numToday < 0)  // Al cambiar el orden del array de días, por pura legibilidad, hacemos que el domingo sea el día 6
            numToday = 6;

        if (weekDay >= numToday) {
            let newDay = hoy.getDate() + (weekDay - numToday);    // Los días que faltan para la fecha serán la diferencia entre ese día y el día que se crea la lista

            let thisMonth = hoy.getMonth();        // Guardamos el mes
            let maxDay = -1;                        // maxDay establecerá el valor más alto en función del mes 28, 29, 30 o 31

            if (thisMonth === 1) {                  // 28 y 29 en febrero
                const anyo = hoy.getFullYear();
                if (anyo % 4 === 0) {
                    anyo % 100 === 0 ? (anyo % 400 === 0 ? maxDay = 29 : maxDay = 28) : maxDay = 29;
                } else {
                    maxDay = 28;
                }
            }
            else if (thisMonth === 3 || thisMonth === 5 || thisMonth === 8 || thisMonth === 10)   // 30 para abril, junio, septiembre y noviembre
                maxDay = 30;
            else                            // 31 para enero, marzo, mayo, julio, agosto, octubre y diciembre
                maxDay = 31;

            if (newDay > maxDay) {         // Si el día es mayor al límite, aumentamos en 1 el mes (o reiniciamos el año si es diciembre) y el nuevo día será la diferencia
                thisMonth++;
                if (thisMonth > 11) {
                    thisMonth = 0;
                }
                newDay = newDay - maxDay;
            }

            return { dia: newDay, mes: thisMonth };
        }

        return null;
    }

    // Función para generar la lista para la próxima quedada
    function generarListaQuedada(data) {
        let textoQuedada =
            `Quedada(s) de esta semana:

    ${data.fechasQuedada}
    Podéis apuntaros a cualquier día
    Recordad que el día con más asistentes será el elegido para quedar

    🕔 16:30 - 20:30
    🏛 La Ciénaga Hobby Shop (C. Leopoldo Alas "Clarín", 3, 29002 Málaga) - https://goo.gl/maps/9VE1Wp85apkyCpjW6
    💵 4€ por persona\n`;

        for (let f of data.fechas) {  //Por cada fecha que pueda haber quedada se genera una lista de usuarios y setups
            textoQuedada +=
                `\n👥 Asistentes ${f.diaSemana} ${f.numeroDia}:\n`;

            for (const u of data.listaQuedada) {
                for (const d of u.dias) {
                    if (d.dia === f.diaSemana) {
                        textoQuedada += '          - ' + (u.preferredName ? u.preferredName : u.user.username || u.user.first_name) + (d.setup ? ' 🍄' : '') + '\n';
                    }
                }
            }
        }

        return textoQuedada; // Devuelve la lista enterita
    }

    function procesarDias(dias, byUsuario, fechas) {   // Función simple para comprobar si un día es válido, hay que ser muy terrorista para escribir mal los días de la semana
        const result = [];

        for (let d of dias) {
            for (let k of diaSemana) {
                const dNormalized = d.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                const kNormalized = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                if (dNormalized === kNormalized) {
                    if (byUsuario && diaDisponible(k, fechas))
                        result.push(k);
                    else if (!byUsuario)
                        result.push(k);
                }
            }
        }
        return result;
    }

    function diaDisponible(dia, fechas) {   // Función para ver si un día corresponde los establecidos por la quedada
        for (let f of fechas) {
            if (dia === f.diaSemana) {
                return true;
            }
        }
        return false;
    }

    function userApuntado(user, listaQuedada) {   // Función para saber si un usuario está apuntado a algún día
        for (let [index, u] of listaQuedada.entries()) {
            if (u.user.id === user.id) {
                return { exists: true, dias: u.dias, index: index };
            }
        }
        return { exists: false, dias: [], index: -1 };
    }

    async function startingExecution() {  // Función que recupera y descrifra los datos de la quedada, y comprueba si hay quedada o no
        const cipher = await loadData();
        const data = decryptData(cipher);
        const quedadaExists = Object.entries(data).length > 0;

        return {data, quedadaExists};
    }

    class CustomError extends Error {  // Clase Error propia para que el bot notifique a los usuarios y filtre otros errores derivados
        constructor(message) {
            super(message);
            this.name = "CustomError";
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // Create our new bot handler with the token
    // that the Botfather gave us
    // Use an environment variable so we don't expose it in our code

    function proximaQuedada(msg) {
        const dias = msg.text?.replace('/proximaQuedada ', '');

        if (!dias || !dias.length > 0) {
            throw new CustomError("Por favor, dime un día válido si no te importa... \n '/proximaQuedada sabado', por ejemplo.");
        }

        const arrayDias = dias.trim().split(' ')
        const actualDias = procesarDias(arrayDias, false, null)

        if (!actualDias.length > 0) {
            throw new CustomError('No hay días válidos. Recuerda que solo valen los días de la semana que aún no hayan pasado.');
        }

        const updatedData = fechaProximaQuedada(actualDias);

        return ({
            fechas: updatedData.fechas,
            fechasQuedada: updatedData.textoFechas,
            listaQuedada: [],
            idQuedada: null,
        });
    }

    // Comando para apuntarse a la quedada
    async function apuntame(msg) {
        const {data, quedadaExists} = await startingExecution();

        if (!quedadaExists) {
            throw new CustomError('¡Qué impaciente! ¡Aún no hay quedada creada! Espera a que el staff cree una.');
        }
        
        const user = msg.from;
            // Verificar si el usuario existe
        if (user) {
            let dias = msg.text?.replace('/apuntame', '');  // De aquí sacamos los días que se apunte el usuario, ej:   /apuntame viernes sabado

            if (!dias || !dias.length > 0) {
                throw new CustomError(`¿Pero qué días quieres ir, @${user.username || user.first_name}? \n Recuerda: "/apuntame [día/s]".`);   
            }

            // Si el usuario ha puesto algo después del /apuntame, entra
            const arrayDias = dias.trim().split(' ')  // Sacamos los dias que haya puesto el usuario
            const actualDias = procesarDias(arrayDias, true, data.fechas)  // Comprobamos que sean días válidos, no sea que el usuario haya puesto /apuntame yogurt chorizo

            if (!actualDias.length > 0) {   // Si hay al menos un día válido, seguimos
                throw new CustomError(`Debes poner al menos un día valido, @${user.username || user.first_name}...`)
            }

            
            const userData = userApuntado(user, data.listaQuedada);  // Comprobamos si el usuario ya estaba apuntado a algo

            if (userData.exists) {       // Si el usuario ya estaba apuntado, hay que hacer unas comprobaciones
                for (const d of actualDias) {
                    let found = false;

                    for (const e of userData.dias) {            // En este bloque se comprueba si en los días que el usuario se ha apuntado a cosas
                        if (!found) {                           // están incluidos días que ha introducido con /apuntame
                            found = d === e.dia;
                        }
                    }

                    if (found) {         // Si el día ya está incluido en sus días, se le avisa de que ya estaba apuntado
                        throw new CustomError( `Ya estabas apuntad@ el ${d.toLowerCase()}, @${user.username || user.first_name}...`);
                    }       // Si no, se incluye en sus días y cambiamos la variable para editar el fijado
                    data.listaQuedada[userData.index].dias.push({ dia: d, setup: false });
                }
            } else {  // Si el usuario no estaba apuntado a nada, se le apunta a los días directamente
                let diasData = [];
                for (const d of actualDias) {
                    diasData.push({ dia: d, setup: false });
                }
                data.listaQuedada.push({ user: user, dias: diasData });  // Se introduce el nuevo usuario
            }
            return data;
        }
    }

    async function apuntarSeta(msg) {
        const {data, quedadaExists} = await startingExecution();

        if (!quedadaExists) {
            throw new CustomError('¡No hay quedada aún! De momento, juega con tu setup en casa, ¿vale?');
        }
        const user = msg.from;

        if (user) {
            let dias = msg.text?.replace('/apuntarSeta', '');

            if (!dias || !dias.length > 0) {
                throw new CustomError(`¿Y qué días quieres llevar setup, @${user.username || user.first_name}? \n Recuerda: /apuntarSeta [día/s].`);
            }

            const arrayDias = dias.trim().split(' ')
            const actualDias = procesarDias(arrayDias, true, data.fechas);


            if (!actualDias.length > 0) {
                throw new CustomError(`Debes poner al menos un día valido, @${user.username || user.first_name}...`)
            }

            let diasData = [];
            const userData = userApuntado(user, data.listaQuedada);

            if (userData.exists) {
                diasData = userData.dias;
                for (const d of actualDias) {
                    let found = false;
                    let dayIndex = -1;

                    for (const [index, e] of userData.dias.entries()) {
                        found = d === e.dia;
                        if (found) {
                            dayIndex = index;
                        }
                    }

                    if (dayIndex >= 0) {
                        if (data.listaQuedada[userData.index].dias[dayIndex].setup) {
                            throw new CustomError(`Ya llevas setup el ${d.toLowerCase()}, @${user.username || user.first_name}...`);
                        }
                        data.listaQuedada[userData.index].dias[dayIndex].setup = true;
                    } else {
                        diasData.push({ dia: d, setup: true });
                    }
                }
            } else {
                for (const d of actualDias) {
                    diasData.push({ dia: d, setup: true });
                }
                data.listaQuedada.push({ user: user, dias: diasData });
            }
            return data;
        }
    }

    async function quitarSeta(msg) {  // Función homóloga a /apuntarSeta. En este caso se puede asumir que es la función contraria y, en general, las condiciones estarán invertidas
        const {data, quedadaExists} = await startingExecution();

        if (!quedadaExists) {
            throw new CustomError('No necesitamos setup porque... ¡no hay ninguna quedada, ill@!');
        }
        
        const user = msg.from;

        if (user) {
            let dias = msg.text?.replace('/quitarSeta', '');

            if (!dias || !dias.length > 0) {
                throw new CustomError(`¿Podrías especificar qué días no vas a llevar setup, @${user.username || user.first_name}? \n Recuerda: "/quitarSeta [día/s]".`);
            }
            const arrayDias = dias.trim().split(' ')
            const actualDias = procesarDias(arrayDias, true, data.fechas)

            if (!actualDias.length > 0) {
                throw new CustomError(`Debes poner al menos un día valido, @${user.username || user.first_name}...`);
            }

            const userData = userApuntado(user, data.listaQuedada);

            if (!userData.exists) {
                throw new CustomError(`No estás apuntado a ningún día, @${user.username || user.first_name}...`);
            }

            for (const d of actualDias) {
                let found = false;
                let dayIndex = -1;

                for (const [index, e] of userData.dias.entries()) {
                    found = d === e.dia;
                    if (found) {
                        dayIndex = index;
                    }
                }

                if (!dayIndex >= 0) {
                    throw new CustomError(`No te apuntaste el ${d.toLowerCase()}, @${user.username || user.first_name}...`);
                }

                if (!data.listaQuedada[userData.index].dias[dayIndex].setup) {
                    throw new CustomError(`No traías setup el ${d.toLowerCase()} de todos modos, @${user.username || user.first_name}...`);
                }
                    data.listaQuedada[userData.index].dias[dayIndex].setup = false;
            }
            return data;
        }
    }

    async function quitame (msg) {  // Función homóloga a /apuntame. En este caso se puede asumir que es la función contraria y, en general, las condiciones estarán invertidas
        const {data, quedadaExists} = await startingExecution();

        if (!quedadaExists) {
            throw new CustomError('¡Echa el freno, madaleno! ¡No se ha anunciado ninguna quedada!');
        }

        const user = msg.from;
        if (user) {
            let dias = msg.text?.replace('/quitame', '');

            if (!dias || !dias.length > 0) {
                throw new CustomError(`¿Y de qué días te quieres quitar, @${user.username || user.first_name}? \n Recuerda: "/quitame [día/s]"`);
            }

            const arrayDias = dias.trim().split(' ');
            const actualDias = procesarDias(arrayDias, true, data.fechas);

            if (!actualDias.length > 0) {
                throw new CustomError(`Debes poner al menos un día valido, @${user.username || user.first_name}...`);
            }

            const userData = userApuntado(user, data.listaQuedada);

            if (!userData.exists) {
                throw new CustomError(`No estás apuntado a ningún día, @${user.username || user.first_name}...`);
            }

            for (const d of actualDias) {
                let found = false;
                let dayIndex = -1;

                for (const [index, e] of userData.dias.entries()) {
                    found = d === e.dia;
                    if (found) {
                        dayIndex = index;
                    }
                }

                if (!dayIndex >= 0) {
                    throw new CustomError(`Pero si no estás apuntado el ${d.toLowerCase()} @${user.username || user.first_name}...`);
                }

                data.listaQuedada[userData.index].dias.splice(dayIndex, 1);
                if (data.listaQuedada[userData.index].dias.length <= 0) {
                    data.listaQuedada.splice(userData.index, 1);
                }
            }
            return data;
        }
    }

    function aiuda() {  // La misma función que tenías, ligeramente formateada y con la información nueva
        return (
`¿Necesitas saber qué comandos puedes usar? ¡Hagamos memoria!

/proximaQuedada [días]
Esto generará la lista de asistentes para la semana (sólo admins) (Ejemplo: "/proximaQuedada viernes" o "/proximaQuedada viernes sabado").

/apuntame [días]
Apúntate a los días que puedas (separados por espacios) (Ejemplo: "/apuntame viernes", "/apuntame viernes sabado").

/quitame [días]
Quítate de los días que no vayas a asistir (separados por espacios) (Ejemplo: "/quitame viernes", "/quitame viernes sabado").

/apuntarSeta [días]
Apunta tu setup a los días que puedas llevarla (separados por espacios) (Ejemplo: "/apuntarSeta viernes", "/apuntarSeta viernes sabado").

/quitarSeta [días]
Quita tu setup de los días que no puedas llevarla (separados por espacios) (Ejemplo: "/quitarSeta viernes", "/quitarSeta viernes sabado").

/ruleset
Imprime una imagen del reglamento oficial en el que jugamos con su stagelist actual en Smash Málaga. /fullruleset para el procedimiento completo.

/soymalo
Si suckeas y quieres dejar de suckear, es tu comando`
        );
    }

    // Esto enviará el ruleset europeo con la imagen del stagelist de Tech Republic IV. Bastante simple.
    function ruleset() {
        const rulesetPath = `https://serverless-smash-malaga-bot.vercel.app/assets/images/ruleset.jpg?a=${Date.now()}`; // Ruta de la imagen
        return {path: rulesetPath, caption: 'Aquí tienes el ruleset oficial. Se juega a 3 stocks 7 minutos y los bans son 3-4-1.\n\nEscribe /fullruleset para explicarte el procedimiento completo.'};
    }

    function fullruleset() {
        return (
    `1️⃣ El orden de baneo se decide a piedra-papel-tijera. Quien gane, será el primero en banear 3 escenarios.

2️⃣ Luego, el perdedor baneará otros 4 escenarios.

3️⃣ Ahora, el ganador eligirá en qué escenario jugar de los dos restantes.

4️⃣ Al acabar la partida, el ganador decidirá si mantener su personaje o cambiar.

5️⃣ El perdedor hará lo mismo a continuación. 

6️⃣ El ganador de la partida baneará 3 escenarios donde NO jugar.

7️⃣ El perdedor de la ronda elegirá en qué escenario SÍ jugar de los seis que quedan.

8️⃣ Repite los pasos 4, 5, 6 y 7 hasta terminar el set.`
        )
    }

    function gitGud() {
        return (
    `Así que eres malísim@, no te preocupes, aquí te dejo un documento espectacular:

    https://docs.google.com/document/d/1WaDOm4X1iDxfXb7oHQBRE7tPD9wX9mLdagw4JzqzT4w/edit?pli=1

    Tiene de todo:

    - Enlace a todos los discord de Smash Ultimate de interés
    - Varias herramientas con información técnica del juego
    - Guías (escritas y audiovisuales) de todos los niveles que abarcan desde los aspectos más básicos del juego a los más top 
    - Notas de todos los parches
    - Información sobre organizaciones, equipos y torneos de Smash Ultimate

    Eso sí, está todo en inglés 🇬🇧, así que si necesitas algo de ayuda, pregunta en este grupo
    `
        )
    }

    try {
        // Create our new bot handler with the token
        // that the Botfather gave us
        // Use an environment variable so we don't expose it in our code
        const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

        // Retrieve the POST request body that gets sent from Telegram
        const { body } = request;

        const msg = body.message;
        const user = msg.from;

        const chatId = msg.chat.id;
        const text = msg.text.trim();
        const textWords = text.split(' ');
        const command = textWords[0];

        const regex = /^\/{1}[A-Z_a-z0-9]+(\s*(\w)*)*$/;
        const regexarroba = /^\/{1}[A-Z_a-z0-9]+(@smashmalaga_bot)(\s*(\w)*)*$/

        if (command.match(regex) || command.match(regexarroba)) {
            parsedCommand = command.replace('@smashmalaga_bot', '');
            switch (parsedCommand) {
                case "/start":
                    await bot.sendMessage(chatId, '¡Hola! Espero que no os pille desprevenidos. ¡Soy SmashMalagaBot! ' +
                    'El nombre es horrible, lo sé, pero mi creador, Asancu., está falto de ideas y no se le ocurrió otro, el muy bobo.');
                    await bot.sendMessage(chatId, `¡Os ayudaré con las quedadas y más!\nEscribid /aiuda para más información.`);
                    await bot.sendMessage(chatId, 'Gente, estoy en una fase muy temprana de desarrollo y puede que haya errores.' + 
                    '\n\nEstoy bastante nervioso y no sé cómo saldrá esto, pero cualquier sugerencia podéis escribir a Asancu. o manifestarla por aquí.' +
                    '\n\n *Desarrolladores*, si estáis interesados, ¡buscadme en GitHub! \n\n ¡Sed buenos!', {parse_mode: 'Markdown'});
                    break;
                case "/proximaQuedada":
                    try {
                            if (chatId !== Number("-1001204113061")) {
                                throw new CustomError(`Lo siento, ¡esta función es exclusiva del grupo Smash Málaga!`);
                            }

                            if (user) {
                                const chatMember = await bot.getChatMember(chatId, user.id);
                                if (!chatMember.status === "administrator" && !chatMember.status === "creator") {
                                    throw new CustomError(`Buen intento, @${user.username || user.first_name}, pero no eres admin ni mucho menos creador...`);
                                }

                                const data = proximaQuedada(msg);
                                const messageToPin = await bot.sendMessage(chatId, generarListaQuedada(data));
                                data.idQuedada = messageToPin.message_id;
                                await bot.pinChatMessage(chatId, data.idQuedada, { disable_notification: true });

                                const encryptedData = encryptData(data);
                                await updatePost(encryptedData);
                            }
                    } catch (e) {
                        if (e.name === "CustomError"){
                            await bot.sendMessage(chatId, e.message);
                        }
                    }
                    break;
                case "/apuntame":
                    try {
                        if (chatId !== Number("-1001204113061")) {
                            throw new CustomError(`Lo siento, ¡esta función es exclusiva del grupo Smash Málaga!`);
                        }

                        if (user) {
                            const modifiedData = await apuntame(msg);
                            await bot.editMessageText(generarListaQuedada(modifiedData), { chat_id: chatId, message_id: modifiedData.idQuedada });
                            await bot.sendMessage(chatId, `¡Vale, estás dentro, @${user.username || user.first_name}!`);
                            
                            const encryptedData = encryptData(modifiedData);
                            await updatePost(encryptedData);
                        }
                    }
                    catch (e) {
                        if (e.name === "CustomError"){
                            await bot.sendMessage(chatId, e.message);
                        }
                    }
                    break;
                case "/apuntarSeta":
                    try {
                        if (chatId !== Number("-1001204113061")) {
                            throw new CustomError(`Lo siento, ¡esta función es exclusiva del grupo Smash Málaga!`);
                        }

                        if (user) {
                            const modifiedData = await apuntarSeta(msg);
                            await bot.editMessageText(generarListaQuedada(modifiedData), { chat_id: chatId, message_id: modifiedData.idQuedada });
                            await bot.sendMessage(chatId, `¡Setup apuntada, @${user.username || user.first_name}! Gracias por aportar material. 😊`);

                            const encryptedData = encryptData(modifiedData);
                            await updatePost(encryptedData);
                        }
                    } 
                    catch(e) {
                        if (e.name === "CustomError"){
                            await bot.sendMessage(chatId, e.message);
                        }
                    }
                    break;
                case "/quitame":
                    try {
                        if (chatId !== Number("-1001204113061")) {
                            throw new CustomError(`Lo siento, ¡esta función es exclusiva del grupo Smash Málaga!`);
                        }

                        if (user) {
                            const modifiedData = await quitame(msg);
                            await bot.editMessageText(generarListaQuedada(modifiedData), { chat_id: chatId, message_id: modifiedData.idQuedada });
                            await bot.sendMessage(chatId, `¡Ya no estás en la quedada, @${user.username || user.first_name}! Esperamos verte en la próxima.`);

                            const encryptedData = encryptData(modifiedData);
                            await updatePost(encryptedData);
                        }
                    } 
                    catch (e) {
                        if (e.name === "CustomError"){
                            await bot.sendMessage(chatId, e.message);
                        }
                    }
                    break;
                case "/quitarSeta":
                    try {
                        if (chatId !== Number("-1001204113061")) {
                            throw new CustomError(`Lo siento, ¡esta función es exclusiva del grupo Smash Málaga!`);
                        }

                        if (user) {
                            const modifiedData = await quitarSeta(msg);
                            await bot.editMessageText(generarListaQuedada(modifiedData), { chat_id: chatId, message_id: modifiedData.idQuedada });
                            await bot.sendMessage(chatId, `¡Setup quitada, @${user.username || user.first_name}!`);

                            const encryptedData = encryptData(modifiedData);
                            await updatePost(encryptedData);
                        }
                    } 
                    catch (e) {
                        if (e.name === "CustomError"){
                            await bot.sendMessage(chatId, e.message);
                        }
                    }
                    break;
                case "/aiuda":
                    await bot.sendMessage(chatId, aiuda());
                    break;
                case "/ruleset":
                    const params = ruleset();
                    await bot.sendPhoto(chatId, params.path, {caption: params.caption});
                    break;
                case "/fullruleset":
                    await bot.sendMessage(chatId, fullruleset());
                    break;
                case "/soymalo":
                    await bot.sendMessage(chatId, gitGud());
                    break;
                default:
                    await bot.sendMessage(chatId, 'Deja de inventarte comandos, por favor');
            }
        }

        // Escucha el evento de nuevos miembros en el grupo
        bot.on('new_chat_members', (msg) => {
            const chatId = msg.chat.id;
            const newMembers = msg.new_chat_members;

            // Iterar sobre los nuevos miembros
            newMembers?.forEach(async (member) => {
                const memberName = member.username || member.first_name;
                const newChallengerImgPath = "https://serverless-smash-malaga-bot.vercel.app/assets/images/newChallenger.gif"
                if (member.username != "smashmalaga_bot") { // Condicional para que no se dé la bienvenida así mismo. Eso es demasiado narcisista y está feo
                    await bot.sendAnimation(chatId, newChallengerImgPath);

                    const holaIllo =
                        `¡Nuev@ contrincante! ¡Te doy la bienvenida al grupo de Smash Málaga, @${memberName}! Espero que disfrutes de tu estancia. Recuerda que hacemos quedadas todos los fines de semana. 
                        \n ¡Escribe /aiuda para saber qué puedes hacer!`;

                    // Enviar el mensaje de bienvenida al nuevo miembro
                    await bot.sendMessage(chatId, holaIllo);
                } else {
                    await bot.sendMessage(chatId, "¡Estamos activos papi! ¡Hola a todo el mundo! 👋")
                }
            });
        });
    }
    catch(error) {
        console.error('Error sending message');
        console.log(error.toString());
    }
    
    // Acknowledge the message with Telegram
    // by sending a 200 HTTP status code
    // The message here doesn't matter.
    response.send('OK');
}