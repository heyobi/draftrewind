import test from 'node:test';
import assert from 'node:assert/strict';
import { filesAppUrl } from '../../src/git/paths.js';

test('filesAppUrl: Belgeler altındaki proje klasörü Dosyalar adresine çevrilir', () => {
  const uri = 'file:///var/mobile/Containers/Data/Application/ABC-123/Documents/Projeler/Tez%202026/';
  assert.equal(filesAppUrl(uri), 'shareddocuments:///var/mobile/Containers/Data/Application/ABC-123/Documents/Projeler/Tez%202026');
});

test('filesAppUrl: Türkçe karakterler ve boşluklar kodlanır, kodlama iki kez yapılmaz', () => {
  const uri = 'file:///private/var/mobile/Library/Mobile%20Documents/iCloud~com~draftrewind~app/Documents/DraftRewind/%C3%96dev%20%C5%9Fu/';
  assert.equal(
    filesAppUrl(uri),
    'shareddocuments:///private/var/mobile/Library/Mobile%20Documents/iCloud~com~draftrewind~app/Documents/DraftRewind/%C3%96dev%20%C5%9Fu'
  );
});
