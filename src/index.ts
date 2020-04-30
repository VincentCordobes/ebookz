import fs from 'fs';
import irc from 'irc';
import net from 'net';
import path from 'path';
import AdmZip from 'adm-zip';

const tmpDir = path.join(__dirname, '../tmp');
const nick = 'Vincent123' + Math.floor(Math.random() * 10);
const client = new irc.Client('irc.irchighway.net', nick, {
  port: 6667,
  channels: ['#ebooks'],
});

type Result<T, E> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: E;
    };

type DCCService = {
  type: 'SEND';
  file: string;
  ip: string;
  port: number;
  length: number;
};

function uint32ToIP(n: number): string {
  const byte1 = n & 255;
  const byte2 = (n >> 8) & 255;
  const byte3 = (n >> 16) & 255;
  const byte4 = (n >> 24) & 255;
  return byte4 + '.' + byte3 + '.' + byte2 + '.' + byte1;
}

// message: DCC SEND SearchBot_results_for__La_promesse_de_l_aube.txt.zip 2907707975 4529 756
function parseDCC(text: string): Result<DCCService, string> {
  const result = text.match(/(?:\S)+/g);
  if (!result) {
    return { ok: false, error: 'Not a DCC command' };
  }

  const [dcc, type, file, ip, port, length] = result;
  if (dcc !== 'DCC') {
    return { ok: false, error: 'Not a DCC command' };
  }

  const isValidService = (raw: string): raw is 'SEND' => ['SEND'].includes(raw);

  if (!isValidService(type)) {
    return { ok: false, error: `${type} is not a valid DCC service` };
  }

  return {
    ok: true,
    value: {
      type,
      file,
      ip: uint32ToIP(Number(ip)),
      port: Number(port),
      length: Number(length),
    },
  };
}

function log(from: string, to: string, message: string) {
  if (to === nick) {
    console.log(from + ' => ' + to + ' : ' + message);
  }
}

type DownloadParams = {
  file: string;
  ip: string;
  port: number;
};
function downloadSearchFile({ file, ip, port }: DownloadParams) {
  return new Promise((resolve, reject) => {
    const writeSteam = fs.createWriteStream(path.join(tmpDir, file));

    let received = 0;
    const buf = Buffer.alloc(4);
    const socket = net.connect(port, ip, () => {
      client.emit('xdcc-connect');
    });

    socket.on('data', data => {
      received += data.length;

      console.log('writing data', { received });
      writeSteam.write(data);

      client.emit('xdcc-data', received);

      buf.writeUInt32BE(received, 0);
      socket.write(buf);
    });

    socket.on('end', () => {
      console.log('socket end', { received });
      writeSteam.end();
      client.emit('xdcc-end');
      resolve();
    });

    socket.on('error', err => {
      writeSteam.end();
      client.emit('xdcc-error', err);
      console.error(err);
      reject();
    });
  });
}

function getSearchContent(archive: string): string[] {
  const zip = new AdmZip(archive);
  const [entry] = zip.getEntries();

  return zip
    .readAsText(entry.entryName)
    .split('\n')
    .map(line => line.match(/^!.*.epub/))
    .filter(Boolean)
    .map(match => match![0]);
}

client.addListener('message', (from, to, message) => {
  log(from, to, message);
});

client.on('ctcp-privmsg', async (from, to, message) => {
  const dccResult = parseDCC(message);
  log(from, to, message);

  if (!dccResult.ok) return;

  console.log('DCC successfully parsed', dccResult);

  await downloadSearchFile(dccResult.value);

  const commands = getSearchContent(path.join(tmpDir, dccResult.value.file));
  console.log(commands);
});

console.log('Waiting 2s before search...');

setTimeout(() => {
  client.say('#ebooks', "@search La promesse de l'aube");
}, 2000);
