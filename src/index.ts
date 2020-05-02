import fs from 'fs';
import irc from 'irc';
import net from 'net';
import path from 'path';
import AdmZip from 'adm-zip';

const tmpDir = path.join(__dirname, '../tmp');
const nick = 'toto' + Math.floor(Math.random() * 100);
const client = new irc.Client('irc.irchighway.net', nick, {
  userName: 'tat',
  port: 6667,
  channels: ['#ebooks'],
});

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

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
  const result = text.match(/([^"\s]|"[^"]+")+/g);
  if (!result) {
    return { ok: false, error: 'Not a DCC command' };
  }

  const [dcc, type, file, ip, port, length] = result;
  if (dcc !== 'DCC') {
    return { ok: false, error: 'Not a DCC command' };
  }

  const isValidService = (raw: string): raw is 'SEND' => ['SEND'].includes(raw);

  if (!isValidService(type)) {
    console.log('Unknown DCC message', { type });
    return { ok: false, error: 'Unknown DCC message' };
  }

  return {
    ok: true,
    value: {
      type,
      file: file.replace(/"/g, ''),
      ip: uint32ToIP(Number(ip)),
      port: Number(port),
      length: Number(length),
    },
  };
}

function log(from: string, to: string, message: string) {
  if (to === nick) {
    console.log(from + ': ' + message);
  }
}

type DownloadParams = {
  file: string;
  ip: string;
  port: number;
};
function download({ file, ip, port }: DownloadParams): Promise<void> {
  console.log('Downloading file...');
  return new Promise((resolve, reject) => {
    const writeSteam = fs.createWriteStream(path.join(tmpDir, file));

    let received = 0;
    const buf = Buffer.alloc(4);
    const socket = net.connect(port, ip, () => {
      client.emit('xdcc-connect');
    });

    socket.on('data', data => {
      received += data.length;
      writeSteam.write(data);
      client.emit('xdcc-data', received);
      buf.writeUInt32BE(received, 0);
      socket.write(buf);
    });

    socket.on('end', () => {
      console.log('File successfully downloaded', { received });
      writeSteam.end();
      client.emit('xdcc-end');
      resolve();
    });

    socket.on('error', err => {
      console.error(err);
      writeSteam.end();
      client.emit('xdcc-error', err);
      reject();
    });
  });
}

function getSearchResult(archive: string): string[] {
  const zip = new AdmZip(archive);
  const [entry] = zip.getEntries();
  const rawText = zip.readAsText(entry.entryName);
  console.log('Archive content', { rawText });
  return rawText
    .split('\n')
    .map(line => line.match(/^!.*.epub/))
    .filter(Boolean)
    .map(match => match![0]);
}

async function handleSearch({ file, ip, port }: DownloadParams) {
  await download({ file, ip, port });
  const commands = getSearchResult(path.join(tmpDir, file));

  console.log(commands);
  commands.forEach(command => client.say('#ebooks', command));
}

client.addListener('message', (from, to, message) => {
  log(from, to, message);
});

client.on('ctcp-privmsg', (from, to, message) => {
  log(from, to, message);

  const dccResult = parseDCC(message);

  if (!dccResult.ok) return;

  if (from === 'Search') {
    console.log('Handling search result...');
    return handleSearch(dccResult.value);
  }
  return download(dccResult.value);
});

console.log('Waiting 2s before search...');

function performSearch(text: string): void {
  console.log('Searching', text);
  client.say('#ebooks', '@search ' + text);
}

setTimeout(() => {
  performSearch("romain gary la promesse de l'aube");
  // client.say('#ebooks', "!Horla Romain Gary - La promesse de l'aube [FR].epub");
}, 2000);
