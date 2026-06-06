import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Calendar, Clock, Trash2, Edit2, Camera, UploadCloud } from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, addHours, addMinutes, parseISO, getHours, getMinutes, differenceInMinutes } from 'date-fns';
import { ja } from 'date-fns/locale';
import { supabase } from './lib/supabaseClient';
import holiday_jp from '@holiday-jp/holiday_jp';
import './index.css';

// Initialize Gemini API
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY, { apiVersion: 'v1' }) : null;

const MEMBERS = [
  { id: 'syuta',    label: 'しゅうた',  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  border: '#93c5fd' },
  { id: 'chinatsu', label: 'ちなつ',    color: '#db2777', bg: 'rgba(236,72,153,0.15)',  border: '#f9a8d4' },
  { id: 'airi',     label: 'あいり',    color: '#d97706', bg: 'rgba(245,158,11,0.15)',  border: '#fcd34d' },
  { id: 'kanna',    label: 'かんな',    color: '#059669', bg: 'rgba(16,185,129,0.15)',  border: '#6ee7b7' },
  { id: 'hidenobu', label: 'ひでのぶ',  color: '#7c3aed', bg: 'rgba(139,92,246,0.15)', border: '#c4b5fd' },
  { id: 'higoke',   label: 'ひご家',    color: '#0891b2', bg: 'rgba(8,145,178,0.15)',  border: '#67e8f9' },
  { id: 'syuta_chinatsu', label: 'しゅうた＆ちなつ', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', border: '#c4b5fd' },
  { id: 'airi_kanna',     label: 'あいり＆かんな',   color: '#14b8a6', bg: 'rgba(20,184,166,0.15)', border: '#99f6e4' },
];

const EVENT_CATEGORIES = [
  { id: 'none', label: 'なし', icon: '' },
  { id: 'school_main', label: '学校', icon: '🏫' },
  { id: 'golf', label: 'ゴルフ', icon: '⛳' },
  { id: 'basketball', label: 'バスケ', icon: '🏀' },
  { id: 'school', label: '塾', icon: '📚' },
  { id: 'abacus', label: 'そろばん', icon: '🧮' },
  { id: 'brass_band', label: '吹奏楽', icon: '🎺' },
  { id: 'shopping', label: '買い物', icon: '🛍️' },
  { id: 'outing', label: 'おでかけ', icon: '🚗' },
  { id: 'work', label: '仕事', icon: '💼' },
  { id: 'hospital', label: '病院', icon: '🏥' },
  { id: 'meal', label: '外食', icon: '🍴' },
  { id: 'drinking', label: '飲み会', icon: '🍺' },
  { id: 'fishing', label: '釣り', icon: '🎣' },
  { id: 'shuji', label: '習字', icon: '🖌️' },
  { id: 'tennis', label: 'テニス', icon: '🎾' },
];

const splitTitle = (fullTitle) => {
  if (!fullTitle) return { icon: '', text: '' };
  const matched = EVENT_CATEGORIES.find(c => c.icon && fullTitle.startsWith(c.icon));
  if (matched) return { icon: matched.icon, text: fullTitle.replace(matched.icon, '').trim() };
  return { icon: '', text: fullTitle };
};

const getMember = (id) => MEMBERS.find(m => m.id === id) || MEMBERS[0];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 7); // 7:00 to 24:00 (18 hours)
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const snapTo15 = (date) => {
  const minutes = date.getMinutes();
  const snapped = Math.floor(minutes / 15) * 15;
  const d = new Date(date);
  d.setMinutes(snapped);
  d.setSeconds(0);
  d.setMilliseconds(0);
  return d;
};

function EventModal({ event, onSave, onDelete, onClose, defaultDate }) {
  const initial = splitTitle(event?.title);
  const [selectedIcon, setSelectedIcon] = useState(initial.icon);
  const [textTitle, setTextTitle] = useState(initial.text);
  const [recurrenceType, setRecurrenceType] = useState('none');
  const [recurrenceCount, setRecurrenceCount] = useState(2);
  const [validationError, setValidationError] = useState('');

  const [form, setForm] = useState(event ? {
    member: event.member,
    title: event.title,
    start_time: format(parseISO(event.start_time), "yyyy-MM-dd'T'HH:mm"),
    end_time: format(parseISO(event.end_time), "yyyy-MM-dd'T'HH:mm"),
    memo: event.memo || '',
  } : {
    member: MEMBERS[0].id,
    title: '',
    start_time: defaultDate ? format(snapTo15(defaultDate), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'08:00"),
    end_time: defaultDate ? format(addHours(snapTo15(defaultDate), 1), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'09:00"),
    memo: '',
  });

  const member = getMember(form.member);

  const validateTimeRange = (startStr, endStr) => {
    const start = parseISO(startStr);
    const end = parseISO(endStr);
    const startHour = getHours(start);
    const endHour = getHours(end);
    const endMinute = getMinutes(end);

    // Check if start time is before 08:00 or end time is after 22:00
    if (startHour < 8 || (startHour === 8 && getMinutes(start) < 0)) {
      return '開始時刻は08:00以降に設定してください';
    }
    if (endHour > 22 || (endHour === 22 && endMinute > 0)) {
      return '終了時刻は22:00以前に設定してください';
    }
    if (endHour < startHour || (endHour === startHour && endMinute <= getMinutes(start))) {
      return '終了時刻は開始時刻より後に設定してください';
    }
    return '';
  };

  const handleStartTimeChange = (val) => {
    const start = parseISO(val);
    let newEnd = addHours(start, 1);
    
    // Ensure end time doesn't exceed 22:00
    if (getHours(newEnd) > 22 || (getHours(newEnd) === 22 && getMinutes(newEnd) > 0)) {
      newEnd = new Date(start);
      newEnd.setHours(22, 0, 0, 0);
    }
    
    const newForm = { ...form, start_time: val, end_time: format(newEnd, "yyyy-MM-dd'T'HH:mm") };
    setForm(newForm);
    setValidationError(validateTimeRange(newForm.start_time, newForm.end_time));
  };

  const handleEndTimeChange = (val) => {
    const newForm = { ...form, end_time: val };
    setForm(newForm);
    setValidationError(validateTimeRange(newForm.start_time, newForm.end_time));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const error = validateTimeRange(form.start_time, form.end_time);
    if (error) {
      setValidationError(error);
      return;
    }
    const finalTitle = (selectedIcon + ' ' + textTitle).trim();
    onSave({ ...form, title: finalTitle, recurrence: !event ? { type: recurrenceType, count: parseInt(recurrenceCount, 10) } : null });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: '1.25rem' }}>
            {event ? '予定を編集' : '新しい予定を追加'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>誰の予定？</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {MEMBERS.map(m => (
                <button
                  key={m.id} type="button"
                  onClick={() => setForm({ ...form, member: m.id })}
                  style={{
                    padding: '6px 14px', border: `2px solid ${form.member === m.id ? m.color : '#e2e8f0'}`,
                    borderRadius: '20px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                    background: form.member === m.id ? m.bg : 'white',
                    color: form.member === m.id ? m.color : '#64748b',
                    transition: 'all 0.2s',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>何の予定？</label>
            <div className="category-grid">
              {EVENT_CATEGORIES.map(cat => (
                <button
                  key={cat.id} type="button"
                  className={`category-btn ${selectedIcon === cat.icon ? 'active' : ''}`}
                  onClick={() => setSelectedIcon(cat.icon)}
                >
                  <span style={{ fontSize: '1rem' }}>{cat.icon || '🏠'}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>タイトル</label>
            <input className="form-control" required value={textTitle}
              onChange={e => setTextTitle(e.target.value)}
              placeholder="例）学校 / 仕事 / 習い事" />
          </div>
          <div style={{ display: 'flex', gap: '15px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>開始（08:00～22:00）</label>
              <input type="datetime-local" className="form-control" required value={form.start_time}
                step="900"
                onChange={e => handleStartTimeChange(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>終了（08:00～22:00）</label>
              <input type="datetime-local" className="form-control" required value={form.end_time}
                step="900"
                onChange={e => handleEndTimeChange(e.target.value)} />
            </div>
          </div>
          {validationError && (
            <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '15px', fontWeight: 500 }}>
              ⚠ {validationError}
            </div>
          )}
          <div className="form-group">
            <label>メモ（任意）</label>
            <textarea className="form-control" rows="2" style={{ resize: 'vertical' }}
              value={form.memo} placeholder="詳細など"
              onChange={e => setForm({ ...form, memo: e.target.value })} />
          </div>
          {!event && (
            <div style={{ display: 'flex', gap: '15px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>繰り返し</label>
                <select className="form-control" value={recurrenceType} onChange={e => setRecurrenceType(e.target.value)}>
                  <option value="none">なし</option>
                  <option value="daily">毎日</option>
                  <option value="weekly">毎週</option>
                  <option value="monthly">毎月</option>
                </select>
              </div>
              {recurrenceType !== 'none' && (
                <div className="form-group" style={{ flex: 1 }}>
                  <label>回数</label>
                  <input type="number" className="form-control" min="2" max="50" value={recurrenceCount}
                    onChange={e => setRecurrenceCount(e.target.value)} />
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
            <div>
              {event && <button type="button" className="btn-danger" onClick={() => onDelete(event.id)}>
                <Trash2 size={14} style={{ display: 'inline', marginRight: 4 }} /> 削除
              </button>}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
              <button type="submit" className="btn-primary">
                {event ? '更新する' : '追加する'}
              </button>
            </div>
          </div>
        </form>
        <div className="mobile-scroll-handle-right" />
      </div>
    </div>
  );
}

function ImageImportModal({ onClose, onParsed }) {
  const [memberId, setMemberId] = useState(MEMBERS[0].id);
  const memberIdRef = useRef(memberId);
  useEffect(() => { memberIdRef.current = memberId; }, [memberId]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorLine, setErrorLine] = useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (!GEMINI_API_KEY) {
        throw new Error('APIキーが設定されていません。RenderのEnvironment設定を確認してください。');
      }
      setIsProcessing(true);
      setErrorLine('');

      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const trimmedKey = GEMINI_API_KEY.trim();
          if (trimmedKey.length < 10) throw new Error('APIキーが読み込めません。');
          
          setIsProcessing(true);
          const base64String = reader.result.split(',')[1];
          
          // Step 1: List all models to find the right ID for this project
          const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmedKey}`;
          const listRes = await fetch(listUrl);
          const listData = await listRes.json();
          
          if (!listData.models) {
            throw new Error(`モデルリストを取得できませんでした: ${JSON.stringify(listData)}`);
          }
          
          const modelNames = listData.models.map(m => m.name.replace('models/', ''));
          console.log('Available models:', modelNames);

          // Find the best flash model
          const flashModel = modelNames.find(n => n.includes('1.5-flash') || n.includes('2.0-flash') || n.includes('2.5-flash')) || modelNames[0];
          
          // Step 2: Use the found model
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${flashModel}:generateContent?key=${trimmedKey}`;
          console.log(`Using model: ${flashModel}`);

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `Extract events as JSON array: [{ "date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "title": "string" }] from this image. Current year is ${new Date().getFullYear()}. JSON ONLY.` },
                  { inline_data: { mime_type: file.type, data: base64String } }
                ]
              }]
            })
          });

          if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(`AIエラー(${response.status}): ${errJson.error?.message || '通信失敗'}\n(利用可能なモデル: ${modelNames.join(', ')})`);
          }

          const result = await response.json();
          const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanText);
          
          const formattedEvents = parsed.map(item => ({
            member: memberIdRef.current,
            title: item.title,
            start_time: `${item.date}T${item.start_time}`,
            end_time: `${item.date}T${item.end_time}`,
            memo: '画像から取り込みました'
          }));

          onParsed(formattedEvents);

        } catch (err) {
          console.error(err);
          setErrorLine(err.message || '読み取りに失敗しました。');
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsDataURL(file);

    } catch (err) {
      setErrorLine('画像の処理中にエラーが発生しました。');
      setIsProcessing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: '1.25rem' }}>画像から読み込む</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
        </div>

        <div className="form-group">
          <label>誰の予定を取り込みますか？</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {MEMBERS.map(m => (
              <button key={m.id} type="button" onClick={() => setMemberId(m.id)}
                style={{
                  padding: '6px 14px', border: `2px solid ${memberId === m.id ? m.color : '#e2e8f0'}`,
                  borderRadius: '20px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                  background: memberId === m.id ? m.bg : 'white',
                  color: memberId === m.id ? m.color : '#64748b', transition: 'all 0.2s',
                }}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          {isProcessing ? (
            <div style={{ padding: '30px', color: '#3b82f6', fontWeight: 'bold' }}>
              <Camera size={40} className="spinner" style={{ marginBottom: '10px' }} />
              <div>AIが画像を解析中...</div>
            </div>
          ) : (
            <div>
              <label htmlFor="image-upload" style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '40px 20px', border: '2px dashed #cbd5e1', borderRadius: '12px',
                cursor: 'pointer', background: '#f8fafc', color: '#64748b', gap: '10px'
              }}>
                <UploadCloud size={40} />
                <span style={{ fontWeight: 'bold' }}>写真を撮る・選ぶ</span>
                <span style={{ fontSize: '0.8rem' }}>AIが予定を自動で読み取ります</span>
              </label>
              <input id="image-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            </div>
          )}
          {errorLine && <div style={{ color: '#ef4444', marginTop: '15px', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{errorLine}</div>}
          <div style={{ marginTop: '10px', fontSize: '0.7rem', color: '#cbd5e1' }}>Build: v1.15-desktop-grid-fix</div>
        </div>
      </div>
    </div>
  );
}

function EventReviewModal({ items, onCancel, onConfirm }) {
  const [editedItems, setEditedItems] = useState(() => 
    items.map(item => {
      // Split title to separate existing icon if any
      const { icon, text } = splitTitle(item.title);
      return { ...item, selected: true, icon: icon, title: text };
    })
  );
  const [itemErrors, setItemErrors] = useState({});

  const validateTimeRange = (startStr, endStr) => {
    const start = parseISO(startStr);
    const end = parseISO(endStr);
    const startHour = getHours(start);
    const endHour = getHours(end);
    const endMinute = getMinutes(end);

    // Check if start time is before 08:00 or end time is after 22:00
    if (startHour < 8 || (startHour === 8 && getMinutes(start) < 0)) {
      return '開始時刻は08:00以降に設定してください';
    }
    if (endHour > 22 || (endHour === 22 && endMinute > 0)) {
      return '終了時刻は22:00以前に設定してください';
    }
    if (endHour < startHour || (endHour === startHour && endMinute <= getMinutes(start))) {
      return '終了時刻は開始時刻より後に設定してください';
    }
    return '';
  };

  const updateItem = (index, field, value) => {
    const newItems = [...editedItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setEditedItems(newItems);
    
    // Validate time range if updating time fields
    if (field === 'start_time' || field === 'end_time') {
      const error = validateTimeRange(
        field === 'start_time' ? value : newItems[index].start_time,
        field === 'end_time' ? value : newItems[index].end_time
      );
      const newErrors = { ...itemErrors };
      if (error) {
        newErrors[index] = error;
      } else {
        delete newErrors[index];
      }
      setItemErrors(newErrors);
    }
  };

  const setQuickTime = (index, type) => {
    const item = editedItems[index];
    let dateStr = '';
    if (item.start_time && item.start_time.includes('T')) {
      dateStr = item.start_time.split('T')[0];
    } else {
      dateStr = format(new Date(), 'yyyy-MM-dd');
    }
    const newItems = [...editedItems];
    if (type === 'AM') {
      newItems[index] = { ...item, start_time: `${dateStr}T08:00`, end_time: `${dateStr}T12:00` };
    } else if (type === 'PM') {
      newItems[index] = { ...item, start_time: `${dateStr}T13:00`, end_time: `${dateStr}T17:00` };
    }
    setEditedItems(newItems);
    
    // Clear error after setting quick time
    const newErrors = { ...itemErrors };
    delete newErrors[index];
    setItemErrors(newErrors);
  };

  const removeItem = (index) => {
    setEditedItems(editedItems.filter((_, i) => i !== index));
    const newErrors = { ...itemErrors };
    delete newErrors[index];
    setItemErrors(newErrors);
  };

  const selectedCount = editedItems.filter(i => i.selected).length;
  const hasErrors = Object.keys(itemErrors).length > 0;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: '1.25rem' }}>読み取り結果の確認</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
        </div>
        
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '15px' }}>アイコンを選び、取り込みたい予定にチェックを入れてください。</p>

        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '5px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {editedItems.map((item, idx) => (
            <div key={idx} style={{ padding: '10px', border: itemErrors[idx] ? '1px solid #ef4444' : '1px solid #e2e8f0', borderRadius: '8px', background: item.selected ? '#f8fafc' : '#f1f5f9', opacity: item.selected ? 1 : 0.6, transition: 'all 0.2s' }}>
              
              {/* Member Selection Row */}
              <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', marginBottom: '8px', paddingBottom: '4px', whiteSpace: 'nowrap', '-webkit-overflow-scrolling': 'touch' }}>
                {MEMBERS.map(m => (
                  <button key={m.id} type="button" onClick={() => updateItem(idx, 'member', m.id)}
                    style={{
                      flexShrink: 0, padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
                      border: `1px solid ${item.member === m.id ? m.color : '#e2e8f0'}`,
                      background: item.member === m.id ? m.bg : 'white',
                      color: item.member === m.id ? m.color : '#64748b'
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Category Icons Row */}
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '10px', paddingBottom: '4px', whiteSpace: 'nowrap', '-webkit-overflow-scrolling': 'touch' }}>
                {EVENT_CATEGORIES.map(cat => (
                  <button key={cat.id} type="button" onClick={() => updateItem(idx, 'icon', cat.icon)}
                    style={{
                      flexShrink: 0, padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                      border: `1px solid ${item.icon === cat.icon ? '#3b82f6' : '#e2e8f0'}`,
                      background: item.icon === cat.icon ? '#eff6ff' : 'white',
                      boxShadow: item.icon === cat.icon ? '0 0 0 1px #3b82f6' : 'none'
                    }}>
                    {cat.icon || '🏠'} {cat.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <input type="checkbox" checked={item.selected} onChange={e => updateItem(idx, 'selected', e.target.checked)} style={{ width: '20px', height: '20px', cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1, position: 'relative' }}>
                  <input className="form-control" style={{ padding: '4px 8px 4px 30px' }} value={item.title} onChange={e => updateItem(idx, 'title', e.target.value)} disabled={!item.selected} />
                  <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>{item.icon || '🏠'}</span>
                </div>
                <button type="button" onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}><Trash2 size={16} /></button>
              </div>
              <div style={{ display: 'flex', gap: '10px', paddingLeft: '30px', marginBottom: itemErrors[idx] ? '6px' : 0 }}>
                <input type="datetime-local" className="form-control" style={{ flex: 1, padding: '4px 8px', fontSize: '0.85rem', borderColor: itemErrors[idx] ? '#ef4444' : undefined }} value={item.start_time} step="900" onChange={e => updateItem(idx, 'start_time', e.target.value)} disabled={!item.selected} />
                <span style={{ alignSelf: 'center', color: '#94a3b8' }}>-</span>
                <input type="datetime-local" className="form-control" style={{ flex: 1, padding: '4px 8px', fontSize: '0.85rem', borderColor: itemErrors[idx] ? '#ef4444' : undefined }} value={item.end_time} step="900" onChange={e => updateItem(idx, 'end_time', e.target.value)} disabled={!item.selected} />
              </div>
              {itemErrors[idx] && (
                <div style={{ color: '#ef4444', fontSize: '0.75rem', paddingLeft: '30px', marginBottom: '6px', fontWeight: 500 }}>
                  ⚠ {itemErrors[idx]}
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px', paddingLeft: '30px', marginTop: '6px' }}>
                <button type="button" onClick={() => setQuickTime(idx, 'AM')} disabled={!item.selected} style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', cursor: 'pointer', fontWeight: 600 }}>AM (8:00-12:00)</button>
                <button type="button" onClick={() => setQuickTime(idx, 'PM')} disabled={!item.selected} style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', cursor: 'pointer', fontWeight: 600 }}>PM (13:00-17:00)</button>
              </div>
            </div>
          ))}
          {editedItems.length === 0 && <p style={{ textAlign: 'center', color: '#ef4444' }}>予定がありません。</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>キャンセル</button>
          <button type="button" className="btn-primary" disabled={selectedCount === 0 || hasErrors} onClick={() => {
            const selectedItems = editedItems.filter(i => i.selected).map(({ selected, icon, title, ...rest }) => ({
              ...rest,
              title: icon ? `${icon} ${title}` : title
            }));
            onConfirm(selectedItems);
          }}>
            選んだ {selectedCount}件 を登録する
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthView({ currentDate, events, onDayClick, onEventClick, onEventMove, onEventCopy, onDragChange }) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();
  
  const longPressTimer = useRef(null);
  const [dragState, setDragState] = useState(null); // { event, x, y, targetDate }
  const [choiceMenu, setChoiceMenu] = useState(null); // { event, targetDate, x, y }
  const lastTapRef = useRef(0);
  const lastEventType = useRef('');
  const tapInfoRef = useRef(null); // { event, x, y, time }

  const handleStart = (e, event) => {
    e.stopPropagation();
    if (e.type === 'mousedown' && lastEventType.current === 'touchstart') return;
    lastEventType.current = e.type;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    tapInfoRef.current = { event, x: clientX, y: clientY, startTime: Date.now() };

    const startDrag = () => {
      const element = document.elementFromPoint(clientX, clientY);
      const dayCell = element?.closest('.month-day');
      const targetDateStr = dayCell?.getAttribute('data-date');
      const initialTargetDate = targetDateStr ? parseISO(targetDateStr) : null;

      onDragChange(true);
      setDragState({
        event: event,
        initialX: clientX,
        initialY: clientY,
        currentX: clientX,
        currentY: clientY,
        targetDate: initialTargetDate
      });
      if (navigator.vibrate) navigator.vibrate(50);
    };

    if (e.touches) {
      longPressTimer.current = setTimeout(startDrag, 1500); // 1.5s
    } else {
      startDrag();
    }
  };

  const handleMove = (e) => {
    if (!dragState) {
      if (longPressTimer.current && e.touches) {
        const startPos = tapInfoRef.current;
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dist = Math.sqrt(Math.pow(x - startPos.x, 2) + Math.pow(y - startPos.y, 2));
        if (dist > 10) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
          tapInfoRef.current = null;
        }
      }
      return;
    }
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    if (tapInfoRef.current) {
      const dist = Math.sqrt(Math.pow(clientX - tapInfoRef.current.x, 2) + Math.pow(clientY - tapInfoRef.current.y, 2));
      if (dist > 10) tapInfoRef.current = null;
    }

    // Find the day cell under finger
    const element = document.elementFromPoint(clientX, clientY);
    const dayCell = element?.closest('.month-day');
    const targetDateStr = dayCell?.getAttribute('data-date');
    const targetDate = targetDateStr ? parseISO(targetDateStr) : null;

    setDragState(prev => ({ ...prev, currentX: clientX, currentY: clientY, targetDate }));
  };

  const handleEnd = () => {
    onDragChange(false);
    clearTimeout(longPressTimer.current);

    const now = Date.now();
    if (tapInfoRef.current) {
      const duration = now - tapInfoRef.current.startTime;
      if (duration < 400) {
        if (now - lastTapRef.current < 350) {
          onEventClick(tapInfoRef.current.event);
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
      }
      tapInfoRef.current = null;
    }

    if (!dragState) return;

    if (dragState.targetDate && !isSameDay(parseISO(dragState.event.start_time), dragState.targetDate)) {
      setChoiceMenu({
        event: dragState.event,
        targetDate: dragState.targetDate,
        x: dragState.currentX,
        y: dragState.currentY
      });
    }
    setDragState(null);
  };

  useEffect(() => {
    if (dragState) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleEnd);
      return () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleEnd);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleEnd);
      };
    }
  }, [dragState]);

  return (
    <div 
      className="month-view-container"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', touchAction: dragState ? 'none' : 'auto' }}
    >
      <div className="weekday-header">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className="weekday-col" style={{ color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : undefined }}>{d}</div>
        ))}
      </div>
      <div className="month-grid">
        {days.map(day => {
          const dayEvents = events.filter(e => isSameDay(parseISO(e.start_time), day));
          const isToday = isSameDay(day, today);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isTarget = dragState?.targetDate && isSameDay(day, dragState.targetDate);
          const holiday = holiday_jp.isHoliday(day) ? holiday_jp.between(day, day)[0] : null;

          return (
            <div
              key={day.toISOString()}
              data-date={format(day, 'yyyy-MM-dd')}
              className={`month-day ${!isCurrentMonth ? 'outside-month' : ''} ${isToday ? 'today' : ''} ${isTarget ? 'drag-target' : ''} ${holiday ? 'is-holiday' : ''}`}
              onClick={() => onDayClick(day)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                <span className={`day-number ${isToday ? 'today' : ''}`}
                  style={{ color: holiday ? '#ef4444' : !isCurrentMonth ? '#cbd5e1' : format(day, 'E') === 'Sun' ? '#ef4444' : format(day, 'E') === 'Sat' ? '#3b82f6' : undefined }}>
                  {format(day, 'd')}
                </span>
                {holiday && <span className="holiday-label">{holiday.name}</span>}
              </div>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                {dayEvents.slice(0, 2).map((ev, idx) => {
                  const m = getMember(ev.member);
                  const isBeingDragged = dragState?.event.id === ev.id;
                  const isLifting = isBeingDragged && dragState?.currentX === dragState?.initialX;
                  const { icon, text } = splitTitle(ev.title);
                  return (
                      <div key={ev.id} className={`event-chip ${isBeingDragged ? 'dragging' : ''} ${isLifting ? 'lifting' : ''}`}
                        style={{ 
                          background: m.bg, 
                          color: m.color, 
                          borderColor: m.border, 
                          opacity: isBeingDragged ? 0.4 : 1,
                          transform: isLifting ? 'scale(1.1) translateY(-2px)' : 'none',
                          zIndex: isLifting ? 100 : 1,
                          transition: isLifting ? 'transform 0.2s ease-out' : 'none'
                        }}
                        onMouseDown={e => handleStart(e, ev)}
                        onTouchStart={e => handleStart(e, ev)}
                        onMouseUp={handleEnd}
                        onTouchEnd={handleEnd}
                        onClick={e => e.stopPropagation()}>
                        {icon && <span className="event-icon">{icon}</span>}
                        <span className="event-time">{format(parseISO(ev.start_time), 'HH:mm')}</span>
                        <span className="event-text">{text}</span>
                      </div>
                  );
                })}
              </div>
              {dayEvents.length > 2 && (
                <div className="more-events-badge">+{dayEvents.length - 2}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Ghost Chip while dragging */}
      {dragState && (
        <div className="event-chip ghost" style={{
          position: 'fixed',
          left: dragState.currentX,
          top: dragState.currentY,
          transform: 'translate(-50%, -100%) scale(1.1)',
          pointerEvents: 'none',
          zIndex: 9999,
          background: getMember(dragState.event.member).bg,
          color: getMember(dragState.event.member).color,
          borderColor: getMember(dragState.event.member).border,
          boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
        }}>
          {dragState.event.title}
        </div>
      )}

      {/* Choice Menu after drop */}
      {choiceMenu && (
        <div className="choice-overlay" onClick={() => setChoiceMenu(null)}>
          <div className="choice-menu" style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 120, Math.max(20, choiceMenu.x - 50)),
            top: Math.min(window.innerHeight - 150, Math.max(20, choiceMenu.y - 120)),
          }} onClick={e => e.stopPropagation()}>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 700, textAlign: 'center' }}>
              {format(choiceMenu.targetDate, 'M/d')} に
            </p>
            <button className="choice-btn move" onClick={() => {
              const start = parseISO(choiceMenu.event.start_time);
              const end = parseISO(choiceMenu.event.end_time);
              const diff = differenceInMinutes(end, start);
              const newStart = new Date(choiceMenu.targetDate);
              newStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
              const newEnd = addMinutes(newStart, diff);
              onEventMove(choiceMenu.event.id, {
                start_time: newStart.toISOString(),
                end_time: newEnd.toISOString()
              });
              setChoiceMenu(null);
            }}>移動する</button>
            <button className="choice-btn copy" onClick={() => {
              onEventCopy(choiceMenu.event, choiceMenu.targetDate);
              setChoiceMenu(null);
            }}>コピーする</button>
            <button className="choice-btn cancel" onClick={() => setChoiceMenu(null)}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimeGrid({ days, events, onTimeClick, onEventClick, onEventMove, onDragChange }) {
  const numDays = days.length;
  const gridRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollInterval = useRef(null);
  const longPressTimer = useRef(null);
  const lastTapRef = useRef(0);
  const lastEventType = useRef('');
  const tapInfoRef = useRef(null); // { event, x, y, startTime }
  const [dragState, setDragState] = useState(null); // { eventId, ... }
  const [activeEditEventId, setActiveEditEventId] = useState(null);

  const handleStart = (e, event, day, dayIndex) => {
    e.stopPropagation();
    if (e.type === 'mousedown' && lastEventType.current === 'touchstart') return;
    lastEventType.current = e.type;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    tapInfoRef.current = { event, x: clientX, y: clientY, startTime: Date.now() };

    // Determine drag type based on touch/click position within the block
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    
    // Increased threshold for active edits on mobile
    const threshold = activeEditEventId === event.id ? 24 : 12;
    let dragType = 'move';
    if (offsetY < threshold) dragType = 'resizeTop';
    else if (offsetY > rect.height - threshold) dragType = 'resizeBottom';

    const startDrag = () => {
      onDragChange(true);
      setActiveEditEventId(event.id);
      setDragState({
        eventId: event.id,
        originalStart: parseISO(event.start_time),
        originalEnd: parseISO(event.end_time),
        initialX: clientX,
        initialY: clientY,
        currentX: clientX,
        currentY: clientY,
        initialDayIndex: dayIndex,
        dragType: dragType,
        wasMoved: false // Track movement
      });
      if (navigator.vibrate) navigator.vibrate(50);
    };

    gridRef.current.touchStartPos = { x: clientX, y: clientY };
    
    if (activeEditEventId === event.id) {
      startDrag();
    } else {
      longPressTimer.current = setTimeout(startDrag, 1000); // 1.0s wait
    }
  };

  const handleMove = (e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    if (!dragState) {
      if (longPressTimer.current && e.touches) {
        const startPos = gridRef.current.touchStartPos;
        const dist = Math.sqrt(Math.pow(clientX - startPos.x, 2) + Math.pow(clientY - startPos.y, 2));
        if (dist > 10) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
          tapInfoRef.current = null;
        }
      }
      return;
    }
    
    e.preventDefault();
    if (tapInfoRef.current) {
      const dist = Math.sqrt(Math.pow(clientX - tapInfoRef.current.x, 2) + Math.pow(clientY - tapInfoRef.current.y, 2));
      if (dist > 10) tapInfoRef.current = null;
    }
    setDragState(prev => ({ ...prev, currentX: clientX, currentY: clientY, wasMoved: true }));

    if (scrollRef.current) {
      const rect = scrollRef.current.getBoundingClientRect();
      const threshold = 60;
      const distFromTop = clientY - rect.top;
      const distFromBottom = rect.bottom - clientY;

      clearInterval(scrollInterval.current);
      if (distFromTop < threshold) {
        scrollInterval.current = setInterval(() => { scrollRef.current.scrollTop -= 10; }, 16);
      } else if (distFromBottom < threshold) {
        scrollInterval.current = setInterval(() => { scrollRef.current.scrollTop += 10; }, 16);
      }
    }
  };

  const handleEnd = async () => {
    onDragChange(false);
    clearTimeout(longPressTimer.current);
    clearInterval(scrollInterval.current);
    
    const now = Date.now();
    if (tapInfoRef.current) {
      const duration = now - tapInfoRef.current.startTime;
      if (duration < 400) {
        if (now - lastTapRef.current < 350) {
          onEventClick(tapInfoRef.current.event);
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
      }
      tapInfoRef.current = null;
    }

    if (!dragState || !gridRef.current) {
      setDragState(null);
      return;
    }

    // No long-press logic for editing here anymore (moved to double tap)
    if (!dragState.wasMoved) {
      setDragState(null);
      return;
    }
    
    const deltaY = dragState.currentY - dragState.initialY;
    const deltaMinutes = Math.round(deltaY / 15) * 15;

    const rect = gridRef.current.getBoundingClientRect();
    const colWidth = rect.width / numDays;
    const currentDayIndex = Math.floor((dragState.currentX - rect.left) / colWidth);
    let dayDelta = Math.max(-dragState.initialDayIndex, Math.min(numDays - 1 - dragState.initialDayIndex, currentDayIndex - dragState.initialDayIndex));

    // If resizing, horizontal day delta is ignored
    if (dragState.dragType !== 'move') dayDelta = 0;

    let movedStart = dragState.originalStart;
    let movedEnd = dragState.originalEnd;

    if (dragState.dragType === 'move') {
      movedStart = addDays(addMinutes(dragState.originalStart, deltaMinutes), dayDelta);
      movedEnd = addDays(addMinutes(dragState.originalEnd, deltaMinutes), dayDelta);
    } else if (dragState.dragType === 'resizeTop') {
      movedStart = addMinutes(dragState.originalStart, deltaMinutes);
      // Min duration 15 mins
      if (differenceInMinutes(movedEnd, movedStart) < 15) {
        movedStart = addMinutes(movedEnd, -15);
      }
    } else if (dragState.dragType === 'resizeBottom') {
      movedEnd = addMinutes(dragState.originalEnd, deltaMinutes);
      // Min duration 15 mins
      if (differenceInMinutes(movedEnd, movedStart) < 15) {
        movedEnd = addMinutes(movedStart, 15);
      }
    }

    // Validate time range (08:00 - 22:00)
    const startHour = getHours(movedStart);
    const endHour = getHours(movedEnd);
    const endMinute = getMinutes(movedEnd);
    
    const isOutOfRange = startHour < 8 || endHour > 22 || (endHour === 22 && endMinute > 0);
    
    if (isOutOfRange) {
      alert('予定は08:00～22:00の範囲内に設定してください。');
      setDragState(null);
      return;
    }

    if (deltaMinutes !== 0 || dayDelta !== 0) {
      onEventMove(dragState.eventId, {
        start_time: movedStart.toISOString(),
        end_time: movedEnd.toISOString()
      });
    }
    setDragState(null);
  };

  useEffect(() => {
    // Auto-scroll to current time on mount or view change
    if (scrollRef.current) {
      const scrollToNow = () => {
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();
        
        // 1 hour = 60px, starting from 7:00
        const pixelsFromStart = (hour - 7) * 60 + min;
        const containerHeight = scrollRef.current.clientHeight;
        const targetScroll = pixelsFromStart - (containerHeight / 2);
        
        scrollRef.current.scrollTop = Math.max(0, targetScroll);
      };
      
      // Small timeout to ensure clientHeight is correctly calculated after render
      const timer = setTimeout(scrollToNow, 100);
      return () => clearTimeout(timer);
    }
  }, [days.length, days[0]?.toISOString()]);

  return (
    <div className="time-grid-wrapper" ref={scrollRef} style={{ touchAction: dragState ? 'none' : 'auto' }}>
      <div className="time-grid-content">
        {/* Time Axis (Sticky Left) */}
        <div className="time-axis">
          {/* Header spacer */}
          <div className="time-axis-header-spacer" />
          {HOURS.map(h => (
            <div key={h} className="time-axis-slot">
              <span>{h}:00</span>
            </div>
          ))}
        </div>

        {/* Scrollable Days Container */}
        <div className={`days-scroll-container ${numDays === 1 ? 'single-day' : ''}`}>
          {/* Day Headers (Sticky Top) */}
          <div className="days-header">
            {days.map(day => {
              const isToday = isSameDay(day, new Date());
              return (
                <div key={day.toISOString()} className={`day-header-cell ${isToday ? 'today' : ''}`}>
                  <span className="day-name">{WEEKDAYS[day.getDay()]}</span>
                  <span className="day-num">{format(day, 'd')}</span>
                </div>
              );
            })}
          </div>

          {/* Day Columns */}
          <div 
            ref={gridRef}
            className="days-grid"
            style={{ gridTemplateColumns: `repeat(${numDays}, 1fr)` }}
          >
          {days.map((day, dayIndex) => {
            const dayEvents = events.filter(e => isSameDay(parseISO(e.start_time), day));
            return (
              <div key={day.toISOString()} className="day-column" style={{ minHeight: `${HOURS.length * 60}px` }} onClick={() => setActiveEditEventId(null)}>
                {/* Grid lines */}
                <div className="grid-lines-container">
                  {HOURS.map(h => <div key={h} className="grid-line" />)}
                </div>
                {/* Events */}
                {dayEvents.map(ev => {
                  const isDragging = dragState?.eventId === ev.id;
                  const start = parseISO(ev.start_time);
                  const end = parseISO(ev.end_time);
                  
                  // Calculate dynamic position during drag (Offset by 7 hours)
                  let startOffset = (getHours(start) - 7) * 60 + getMinutes(start);
                  let durationMins = Math.max(differenceInMinutes(end, start), 30);
                  let translateX = 0;
                  let displayStart = start;
                  let displayEnd = end;

                  if (isDragging && gridRef.current) {
                    const deltaY = dragState.currentY - dragState.initialY;
                    const snappedDelta = Math.round(deltaY / 15) * 15;

                    if (dragState.dragType === 'move') {
                      startOffset += snappedDelta;
                      const rect = gridRef.current.getBoundingClientRect();
                      const colWidth = rect.width / numDays;
                      const dayDelta = Math.max(-dragState.initialDayIndex, Math.min(numDays - 1 - dragState.initialDayIndex, Math.floor((dragState.currentX - rect.left) / colWidth) - dragState.initialDayIndex));
                      translateX = dayDelta * 100;
                      displayStart = addDays(addMinutes(start, snappedDelta), dayDelta);
                      displayEnd = addDays(addMinutes(end, snappedDelta), dayDelta);
                    } else if (dragState.dragType === 'resizeTop') {
                      const newStartOffset = startOffset + snappedDelta;
                      const oldEndOffset = startOffset + durationMins;
                      const cappedStartOffset = Math.min(newStartOffset, oldEndOffset - 15);
                      startOffset = cappedStartOffset;
                      durationMins = oldEndOffset - startOffset;
                      displayStart = addMinutes(start, snappedDelta);
                      if (differenceInMinutes(displayEnd, displayStart) < 15) displayStart = addMinutes(displayEnd, -15);
                    } else if (dragState.dragType === 'resizeBottom') {
                      durationMins = Math.max(durationMins + snappedDelta, 15);
                      displayEnd = addMinutes(end, snappedDelta);
                      if (differenceInMinutes(displayEnd, displayStart) < 15) displayEnd = addMinutes(displayStart, 15);
                    }
                  }
                  
                  const m = getMember(ev.member);
                  const { icon, text } = splitTitle(ev.title);
                  const isActiveEdit = activeEditEventId === ev.id;
                  
                  return (
                    <div key={ev.id} className={`event-block ${isDragging ? 'dragging' : ''} ${isActiveEdit ? 'active-edit' : ''}`}
                      style={{ 
                        top: startOffset, 
                        height: durationMins, 
                        background: m.bg, 
                        color: m.color, 
                        borderColor: m.border,
                        opacity: isDragging ? 0.9 : 1,
                        zIndex: isActiveEdit || isDragging ? 100 : 5,
                        boxShadow: isActiveEdit || isDragging 
                          ? '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)' 
                          : 'var(--shadow-sm)',
                        cursor: 'grab',
                        transform: isDragging 
                          ? `translateX(${translateX}%) scale(1.02) translateY(-4px)`
                          : isActiveEdit 
                            ? `scale(1.02) translateY(-4px)` 
                            : 'none',
                        transition: isActiveEdit || isDragging ? 'none' : 'transform 0.2s ease-out, box-shadow 0.2s ease-out, top 0.1s'
                      }}
                      onMouseDown={e => {
                        gridRef.current.wasMoved = false;
                        handleStart(e, ev, day, dayIndex);
                      }}
                      onTouchStart={e => {
                        gridRef.current.wasMoved = false;
                        handleStart(e, ev, day, dayIndex);
                      }}
                      onMouseUp={handleEnd}
                      onTouchEnd={handleEnd}
                      onMouseMove={(e) => { 
                        if (dragState) {
                          gridRef.current.wasMoved = true;
                          handleMove(e);
                        }
                      }}
                      onTouchMove={(e) => { 
                        if (dragState) {
                          gridRef.current.wasMoved = true;
                          handleMove(e);
                        }
                      }}
                      onClick={e => e.stopPropagation()}>
                      {/* Resize handles */}
                      <div className="resize-handle top" />
                      <div className="resize-handle bottom" />
                      
                      <div className="event-block-content">
                        {icon && <div className="event-block-icon">{icon}</div>}
                        <div className="event-block-title">{text}</div>
                      </div>
                      {isDragging && (
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, opacity: 0.9, marginTop: 2 }}>
                          {format(displayStart, 'HH:mm')} - {format(displayEnd, 'HH:mm')}
                          {!isSameDay(displayStart, start) && ` (${format(displayStart, 'M/d')})`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

        {/* Right-side scroll area (Symmetrical to left) */}
        <div className="time-axis right-side">
          <div className="time-axis-header-spacer" />
          {HOURS.map(h => (
            <div key={h} className="time-axis-slot" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { event, defaultDate }
  const [isDragging, setIsDragging] = useState(false);
  const [filterMemberId, setFilterMemberId] = useState(null);
  const [importState, setImportState] = useState(null); // 'upload' | 'review' | null
  const [parsedEvents, setParsedEvents] = useState([]);

  const filteredEvents = filterMemberId
    ? events.filter(e => e.member === filterMemberId)
    : events;

  useEffect(() => { fetchEvents(); }, []);

  const fetchEvents = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('events').select('*').order('start_time', { ascending: true });
    if (!error && data) setEvents(data);
    setIsLoading(false);
  };

  const handleSave = async (form) => {
    if (modalState?.event) {
      const eventData = {
        member: form.member,
        title: form.title,
        memo: form.memo,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString()
      };
      const { error } = await supabase.from('events').update(eventData).eq('id', modalState.event.id);
      if (!error) setEvents(events.map(e => e.id === modalState.event.id ? { ...e, ...eventData } : e));
    } else {
      let eventsToInsert = [];
      const baseStart = new Date(form.start_time);
      const baseEnd = new Date(form.end_time);
      const count = form.recurrence && form.recurrence.type !== 'none' ? form.recurrence.count : 1;

      for (let i = 0; i < count; i++) {
        let currentStart = baseStart;
        let currentEnd = baseEnd;

        if (i > 0) {
          if (form.recurrence.type === 'daily') {
            currentStart = addDays(baseStart, i);
            currentEnd = addDays(baseEnd, i);
          } else if (form.recurrence.type === 'weekly') {
            currentStart = addWeeks(baseStart, i);
            currentEnd = addWeeks(baseEnd, i);
          } else if (form.recurrence.type === 'monthly') {
            currentStart = addMonths(baseStart, i);
            currentEnd = addMonths(baseEnd, i);
          }
        }

        eventsToInsert.push({
          member: form.member,
          title: form.title,
          memo: form.memo,
          start_time: currentStart.toISOString(),
          end_time: currentEnd.toISOString()
        });
      }

      const { data, error } = await supabase.from('events').insert(eventsToInsert).select();
      if (!error && data) setEvents([...events, ...data].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    }
    setModalState(null);
  };

  const handleParsed = (events) => {
    setParsedEvents(events);
    setImportState('review');
  };

  const handleConfirmImport = async (eventsToImport) => {
    // Validate time range for all events
    const validEvents = [];
    const invalidEvents = [];
    
    eventsToImport.forEach(event => {
      // Parse datetime-local format (YYYY-MM-DDThh:mm) as local time
      const start = new Date(event.start_time);
      const end = new Date(event.end_time);
      const startHour = start.getHours();
      const endHour = end.getHours();
      const endMinute = end.getMinutes();
      
      // Check if within 08:00-22:00 range
      if (startHour >= 8 && endHour <= 22 && (endHour < 22 || endMinute === 0)) {
        // Convert to ISO string (UTC)
        validEvents.push({
          ...event,
          start_time: start.toISOString(),
          end_time: end.toISOString()
        });
      } else {
        invalidEvents.push(event.title);
      }
    });
    
    if (validEvents.length === 0) {
      alert('登録できる予定がありません。時間が08:00～22:00の範囲内か確認してください。');
      return;
    }
    
    const { data, error } = await supabase.from('events').insert(validEvents).select();
    if (!error && data) {
      setEvents([...events, ...data].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      if (invalidEvents.length > 0) {
        alert(`${validEvents.length}件の予定を登録しました。\n\n${invalidEvents.length}件は時間が範囲外のため登録できませんでした:\n${invalidEvents.join(', ')}`);
      }
    } else {
      alert('登録に失敗しました。時間や形式が正しいか確認してください。');
    }
    setImportState(null);
    setParsedEvents([]);
  };

  const handleEventMove = async (id, newTimes) => {
    // Ensure times are standardized ISO strings
    const start = new Date(newTimes.start_time);
    const end = new Date(newTimes.end_time);
    const formattedTimes = {
      start_time: start.toISOString(),
      end_time: end.toISOString()
    };
    const { error } = await supabase.from('events').update(formattedTimes).eq('id', id);
    if (!error) {
      setEvents(events.map(e => e.id === id ? { ...e, ...formattedTimes } : e));
    } else {
      alert('予定の移動に失敗しました。');
    }
  };

  const handleEventCopy = async (originalEvent, targetDay) => {
    const start = parseISO(originalEvent.start_time);
    const end = parseISO(originalEvent.end_time);
    const durationMins = differenceInMinutes(end, start);
    
    // Create new start time on target day with same hour/min
    const newStart = new Date(targetDay);
    newStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
    const newEnd = addMinutes(newStart, durationMins);

    const newEvent = {
      member: originalEvent.member,
      title: originalEvent.title,
      start_time: newStart.toISOString(),
      end_time: newEnd.toISOString(),
      memo: originalEvent.memo || ''
    };

    const { data, error } = await supabase.from('events').insert([newEvent]).select();
    if (!error && data) {
      setEvents([...events, ...data].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    } else {
      alert('予定のコピーに失敗しました。');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('この予定を削除しますか？')) return;
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (!error) setEvents(events.filter(e => e.id !== id));
    setModalState(null);
  };

  // Navigation
  const navPrev = () => {
    if (view === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };
  const navNext = () => {
    if (view === 'month') setCurrentDate(addMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const headerLabel = () => {
    if (view === 'month') return format(currentDate, 'yyyy年 M月', { locale: ja });
    if (view === 'week') {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      return `${format(ws, 'M/d')} – ${format(we, 'M/d')}`;
    }
    return format(currentDate, 'yyyy年 M月 d日 (EEE)', { locale: ja });
  };

  const weekDays = eachDayOfInterval({ start: startOfWeek(currentDate, { weekStartsOn: 0 }), end: endOfWeek(currentDate, { weekStartsOn: 0 }) });

  const handleNewEvent = (dt) => {
    // If dt is just a date without precise time (clicked header or FAB), use current time snapped to 15m
    const now = new Date();
    const baseDate = dt || currentDate;
    const start = new Date(baseDate);
    
    // Default to current hour/min if it's the current day, or 08:00 if it's another day
    if (isSameDay(baseDate, now)) {
      const currentHour = now.getHours();
      const currentMinute = Math.round(now.getMinutes() / 15) * 15;
      
      // Clamp to 08:00-22:00 range
      if (currentHour < 8) {
        start.setHours(8, 0, 0, 0);
      } else if (currentHour >= 22) {
        start.setHours(8, 0, 0, 0);
      } else {
        start.setHours(currentHour, currentMinute, 0, 0);
      }
    } else {
      start.setHours(8, 0, 0, 0);
    }
    
    setModalState({ event: null, defaultDate: start });
  };

  return (
    <div className={`calendar-wrapper ${isDragging ? 'is-dragging' : ''} ${modalState || importState ? 'modal-open' : ''} ${isLoading ? 'loading' : ''}`}>
      {/* Floating Action Buttons for Mobile */}
      <div className="fab-container">
        <button className="fab-btn fab-secondary" onClick={() => setImportState('upload')} aria-label="画像から追加">
          <Camera size={24} />
        </button>
        <button className="fab-btn fab-primary" onClick={() => handleNewEvent()} aria-label="予定を追加">
          <Plus size={28} />
        </button>
      </div>

      <header className="calendar-header">
        <div className="header-title">
          <Calendar size={28} color="#3b82f6" />
          <h1>家族カレンダー</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div className="legend">
            {MEMBERS.map(m => (
              <button
                key={m.id}
                className={`legend-item ${filterMemberId === m.id ? 'active' : ''}`}
                onClick={() => setFilterMemberId(filterMemberId === m.id ? null : m.id)}
                style={{
                  background: filterMemberId === m.id ? m.bg : 'transparent',
                  borderColor: filterMemberId === m.id ? m.color : 'transparent'
                }}
              >
                <div className="legend-color" style={{ background: m.color }} />
                {m.label}
              </button>
            ))}
          </div>
          <div className="view-toggles">
            {['month', 'week', 'day'].map(v => (
              <button key={v} className={`view-toggle-btn ${view === v ? 'active' : ''}`}
                onClick={() => setView(v)}>
                {v === 'month' ? '月' : v === 'week' ? '週' : '日'}
              </button>
            ))}
          </div>
          <div className="nav-buttons">
            <button className="nav-btn" onClick={navPrev}><ChevronLeft size={18} /></button>
            <span style={{ fontWeight: 700, fontSize: '1rem', minWidth: '150px', textAlign: 'center' }}>
              {headerLabel()}
            </span>
            <button className="nav-btn" onClick={navNext}><ChevronRight size={18} /></button>
          </div>
          <button className="btn-primary desktop-only" onClick={() => handleNewEvent()}>
            <Plus size={18} /> 予定を追加
          </button>
        </div>
      </header>

      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#3b82f6', fontWeight: 600 }}>読み込み中...</p>
        </div>
      ) : (
        <>
          {view === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={filteredEvents}
              onDayClick={(day) => { setCurrentDate(day); setView('day'); }}
              onEventClick={(ev) => setModalState({ event: ev, defaultDate: null })}
              onEventMove={handleEventMove}
              onEventCopy={handleEventCopy}
              onDragChange={setIsDragging}
            />
          )}
          {view === 'week' && (
            <TimeGrid
              days={weekDays}
              events={filteredEvents}
              onTimeClick={(dt) => setModalState({ event: null, defaultDate: dt })}
              onEventClick={(ev) => setModalState({ event: ev, defaultDate: null })}
              onEventMove={handleEventMove}
              onDragChange={setIsDragging}
            />
          )}
          {view === 'day' && (
            <TimeGrid
              days={[currentDate]}
              events={filteredEvents}
              onTimeClick={(dt) => setModalState({ event: null, defaultDate: dt })}
              onEventClick={(ev) => setModalState({ event: ev, defaultDate: null })}
              onEventMove={handleEventMove}
              onDragChange={setIsDragging}
            />
          )}
        </>
      )}

      {modalState !== null && (
        <EventModal
          event={modalState.event}
          defaultDate={modalState.defaultDate}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModalState(null)}
        />
      )}

      {importState === 'upload' && <ImageImportModal onClose={() => setImportState(null)} onParsed={handleParsed} />}
      {importState === 'review' && <EventReviewModal items={parsedEvents} onCancel={() => setImportState(null)} onConfirm={handleConfirmImport} />}
    </div>
  );
}
