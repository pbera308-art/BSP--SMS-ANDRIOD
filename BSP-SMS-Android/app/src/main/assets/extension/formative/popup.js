document.getElementById('fillBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.style.color = '#555';
  statusEl.textContent = 'নম্বর বসানো হচ্ছে...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: autoFillMarksLogic
    });

    let totalFilled = 0;
    if (results) {
      results.forEach(res => {
        if (res.result && res.result.count) {
          totalFilled += res.result.count;
        }
      });
    }

    if (totalFilled > 0) {
      statusEl.style.color = '#188038';
      statusEl.textContent = `সফলভাবে ${totalFilled} জন ছাত্রের নম্বর বসানো হয়েছে!`;
    } else {
      statusEl.style.color = '#d93025';
      statusEl.textContent = 'কোনো ইনপুট বক্স পাওয়া যায়নি!';
    }
  } catch (err) {
    statusEl.style.color = '#d93025';
    statusEl.textContent = 'Error: ' + err.message;
  }
});

function autoFillMarksLogic() {
  // ১. পেজ থেকে Full Marks খুঁজে বের করা (20 নাকি 10)
  const pageText = document.body.innerText || "";
  let fullMarks = 20;
  let minMarks = 17;

  // রেজেক্স দিয়ে "Full Marks - 10" বা "Full Marks : 10" চেক করা
  const fmMatch = pageText.match(/Full\s*Marks\s*[-:]\s*(\d+)/i);
  if (fmMatch && fmMatch[1]) {
    const detected = parseInt(fmMatch[1], 10);
    if (detected === 10) {
      fullMarks = 10;
      minMarks = 7;
    } else if (detected === 20) {
      fullMarks = 20;
      minMarks = 17;
    }
  } else if (pageText.includes("Full Marks - 10") || (!pageText.includes("20") && pageText.includes("10"))) {
    fullMarks = 10;
    minMarks = 7;
  }

  // ২. টেবিলের রো বা ইনপুট ফিল্ডগুলো খুঁজে বের করা
  const rows = document.querySelectorAll('tr');
  let inputRows = [];

  rows.forEach(row => {
    const inputs = Array.from(row.querySelectorAll('input')).filter(inp => 
      (inp.type === 'text' || inp.type === 'number' || !inp.type) && 
      !inp.disabled && !inp.readOnly && inp.offsetParent !== null
    );
    if (inputs.length === 3) {
      inputRows.push(inputs);
    }
  });

  // যদি tr দিয়ে না পাওয়া যায়, তবে সব দৃশ্যমান টেক্সট/নাম্বার ইনপুট ৩টি করে গ্রুপ করা
  if (inputRows.length === 0) {
    const allInputs = Array.from(document.querySelectorAll('input')).filter(inp => 
      (inp.type === 'text' || inp.type === 'number' || !inp.type) && 
      !inp.disabled && !inp.readOnly && inp.offsetParent !== null
    );
    for (let i = 0; i < allInputs.length; i += 3) {
      if (i + 2 < allInputs.length) {
        inputRows.push([allInputs[i], allInputs[i + 1], allInputs[i + 2]]);
      }
    }
  }

  if (inputRows.length === 0) {
    return { count: 0 };
  }

  // র্যান্ডম শাফেল ফাংশন (Fisher-Yates)
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Angular বা React ফ্রেমওয়ার্কে সঠিকভাবে ভ্যালু সেট করার ফাংশন
  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (valueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ৩. প্রতি ১০ জনের ব্যাচ অনুযায়ী নম্বর বসানো
  // ব্যাচ ০: [M, M, M]
  // ব্যাচ ১: [M, M, M-1]
  // ব্যাচ ২: [M, M-1, M-1]
  // ব্যাচ ৩: [M-1, M-1, M-1]
  // ব্যাচ ৪: [M-1, M-1, M-2] ... এভাবে চলবে (minMarks পর্যন্ত)
  inputRows.forEach((inputs, studentIndex) => {
    const batchIndex = Math.floor(studentIndex / 10);
    
    // প্রতিটি স্টেপ মানে ৩টি ঘরের মোট যোগফল থেকে ১ করে কমানো
    // শুরুতে মোট যোগফল = fullMarks * 3
    // সর্বনিম্ন মোট যোগফল = minMarks * 3
    const maxTotal = fullMarks * 3;
    const minTotal = minMarks * 3;
    const targetTotal = Math.max(minTotal, maxTotal - batchIndex);

    // targetTotal কে ৩টি সংখ্যায় ভাগ করা (যাতে পার্থক্য সর্বোচ্চ ১ হয়)
    const baseVal = Math.floor(targetTotal / 3);
    const remainder = targetTotal % 3;

    let marks = [baseVal, baseVal, baseVal];
    for (let r = 0; r < remainder; r++) {
      marks[r] += 1;
    }

    // ৩টি ঘরে র্যান্ডমলি বসানোর জন্য শাফেল করা
    marks = shuffleArray(marks);

    inputs.forEach((input, idx) => {
      setNativeValue(input, marks[idx]);
    });
  });

  return { count: inputRows.length, fullMarks: fullMarks };
}
