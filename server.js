const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// تخزين بيانات الغرف والجولات
const rooms = {};

io.on('connection', (socket) => {
    console.log('مدرب جديد اتصل باللعبة:', socket.id);

    // 1. إنشاء غرفة جديدة
    socket.on('createRoom', ({ roomName, roomCode, playerName }) => {
        if (!/^\d{4}$/.test(roomCode)) {
            return socket.emit('errorMsg', 'كود الغرفة لازم يكون 4 أرقام فقط!');
        }

        if (roomCode === '1111') {
            socket.join('admin-room');
            return socket.emit('adminModeActivated', { roomCode: '1111', roomName: 'لوحة الإدارة والأدمن' });
        }

        if (rooms[roomCode]) {
            return socket.emit('errorMsg', 'كود الغرفة ده مستخدم بالفعل، اختر كود آخر!');
        }

        rooms[roomCode] = {
            name: roomName,
            code: roomCode,
            currentRound: 1,
            players: [{ id: socket.id, name: playerName, team: null, roundPlayed: 0, points: 0, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 }],
            matchesPlayedInRound: 0,
            news: []
        };

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit('roomCreated', {
            roomName,
            roomCode,
            players: rooms[roomCode].players,
            currentRound: 1
        });
    });

    // 2. الانضمام لغرفة
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (!/^\d{4}$/.test(roomCode)) {
            return socket.emit('errorMsg', 'كود الغرفة لازم يكون 4 أرقام فقط!');
        }

        if (roomCode === '1111') {
            socket.join('admin-room');
            return socket.emit('adminModeActivated', { roomCode: '1111', roomName: 'لوحة الإدارة والأدمن' });
        }

        const room = rooms[roomCode];
        if (!room) {
            return socket.emit('errorMsg', 'الغرفة غير موجودة، تأكد من الكود!');
        }

        const newPlayer = { id: socket.id, name: playerName, team: null, roundPlayed: 0, points: 0, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
        room.players.push(newPlayer);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit('joinedSuccessfully', {
            roomName: room.name,
            roomCode: room.code,
            players: room.players,
            currentRound: room.currentRound
        });

        io.to(roomCode).emit('playerJoined', {
            players: room.players,
            message: `انضم المدرب ${playerName} للغرفة!`
        });
    });

    // 3. اختيار فريق للمدرب
    socket.on('assignTeam', ({ roomCode, teamName }) => {
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.team = teamName;
                io.to(roomCode).emit('updateRoomState', { players: room.players });
            }
        }
    });

    // 4. إرسال خبر من الإدارة أو المدربين
    socket.on('publishNews', ({ roomCode, newsText }) => {
        io.emit('globalNewsBroadcast', newsText);
    });

    // 5. نقل لاعب مباشر (لوحة الإدارة)
    socket.on('adminTransferPlayer', (transferData) => {
        io.emit('executePlayerTransfer', transferData);
    });

    // 6. تقديم عرض لشراء لاعب باسم أندية الكمبيوتر (لوحة الإدارة)
    socket.on('adminSendOffer', (offerData) => {
        io.emit('receiveAdminOffer', offerData);
    });

    // 7. لعب مباراة الجولة
    socket.on('playMatch', ({ roomCode, myScore, oppScore }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (player.roundPlayed >= room.currentRound) {
            return socket.emit('errorMsg', 'لقد لعبت مباراة هذه الجولة بالفعل! انتظر باقي المدربين.');
        }

        player.roundPlayed = room.currentRound;
        player.played += 1;
        player.gf += myScore;
        player.ga += oppScore;

        if (myScore > oppScore) {
            player.points += 3;
            player.wins += 1;
        } else if (myScore === oppScore) {
            player.points += 1;
            player.draws += 1;
        } else {
            player.losses += 1;
        }

        room.matchesPlayedInRound += 1;

        // التحقق من إن كل المدربين خلصوا الجولة
        const allPlayed = room.players.every(p => p.roundPlayed >= room.currentRound);
        if (allPlayed) {
            room.currentRound += 1;
            room.matchesPlayedInRound = 0;
            io.to(roomCode).emit('roundAdvanced', {
                currentRound: room.currentRound,
                players: room.players,
                message: `🔥 اكتملت الجولة! انطلقت الجولة رقم ${room.currentRound} الآن للجميع.`
            });
        } else {
            io.to(roomCode).emit('updateStandings', {
                players: room.players,
                message: `لعب المدرب ${player.name} مباراته في الجولة ${room.currentRound}.`
            });
        }
    });

    // 8. الانفصال
    socket.on('disconnect', () => {
        if (socket.roomCode && rooms[socket.roomCode]) {
            const room = rooms[socket.roomCode];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[socket.roomCode];
            } else {
                io.to(socket.roomCode).emit('playerLeft', { players: room.players });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال بنجاح على البورت: ${PORT}`);
});