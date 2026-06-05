(function () {
  'use strict';

  var NAME_MIN = 2;
  var MESSAGE_MIN = 5;
  var MESSAGE_MAX = 4000;
  var ALLOWED_CATEGORIES = ['general', 'bug', 'correction', 'media', 'partnership'];

  var FIELD_INPUT = {
    name: '#contact-name',
    email: '#contact-email',
    category: '#contact-category',
    message: '#contact-message',
    turnstile: '.turnstile-wrap'
  };

  function getValues(form) {
    return {
      name: (form.querySelector('[name="name"]').value || '').trim(),
      email: (form.querySelector('[name="email"]').value || '').trim(),
      category: (form.querySelector('[name="category"]').value || '').trim(),
      message: (form.querySelector('[name="message"]').value || '').trim()
    };
  }

  function validateValues(values) {
    var details = [];

    if (values.name.length < NAME_MIN) details.push('name');
    if (!values.email || values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      details.push('email');
    }
    if (ALLOWED_CATEGORIES.indexOf(values.category) === -1) details.push('category');
    if (values.message.length < MESSAGE_MIN || values.message.length > MESSAGE_MAX) details.push('message');

    return details;
  }

  function messageForField(field, values) {
    switch (field) {
      case 'name':
        return 'Name must be at least ' + NAME_MIN + ' characters.';
      case 'email':
        return 'Enter a valid email address.';
      case 'category':
        return 'Please select a category.';
      case 'message':
        if (values.message.length > MESSAGE_MAX) {
          return 'Message must be ' + MESSAGE_MAX.toLocaleString('en-CA') + ' characters or fewer.';
        }
        return 'Message must be at least ' + MESSAGE_MIN + ' characters.';
      case 'turnstile':
        return 'Please complete the verification check below.';
      default:
        return 'This field needs attention.';
    }
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.form-field--error').forEach(function (wrap) {
      wrap.classList.remove('form-field--error');
    });
    form.querySelectorAll('.field-error').forEach(function (el) {
      el.textContent = '';
      el.hidden = true;
    });
    form.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function showFieldErrors(form, details, values) {
    clearFieldErrors(form);

    details.forEach(function (field) {
      var wrap = form.querySelector('[data-field="' + field + '"]');
      var errorEl = form.querySelector('#contact-' + field + '-error');
      var inputSel = FIELD_INPUT[field];
      var input = inputSel ? form.querySelector(inputSel) : null;

      if (wrap) wrap.classList.add('form-field--error');
      if (errorEl) {
        errorEl.textContent = messageForField(field, values);
        errorEl.hidden = false;
      }
      if (input && input.setAttribute) {
        input.setAttribute('aria-invalid', 'true');
        if (errorEl && errorEl.id) {
          var describedBy = input.getAttribute('aria-describedby') || '';
          if (describedBy.indexOf(errorEl.id) === -1) {
            input.setAttribute('aria-describedby', describedBy ? describedBy + ' ' + errorEl.id : errorEl.id);
          }
        }
      }
    });

    var first = form.querySelector('.form-field--error input, .form-field--error select, .form-field--error textarea');
    if (first && first.focus) first.focus();
  }

  function initContactForm() {
    var form = document.getElementById('contact-form');
    var submitBtn = document.getElementById('contact-submit');
    var statusEl = document.getElementById('contact-status');
    if (!form || !submitBtn || !statusEl) return;

    ['name', 'email', 'message'].forEach(function (field) {
      var input = form.querySelector(FIELD_INPUT[field]);
      if (!input) return;
      input.addEventListener('input', function () {
        var wrap = form.querySelector('[data-field="' + field + '"]');
        var errorEl = form.querySelector('#contact-' + field + '-error');
        if (wrap) wrap.classList.remove('form-field--error');
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.hidden = true;
        }
        input.removeAttribute('aria-invalid');
      });
    });

    var categoryInput = form.querySelector(FIELD_INPUT.category);
    if (categoryInput) {
      categoryInput.addEventListener('change', function () {
        var wrap = form.querySelector('[data-field="category"]');
        var errorEl = form.querySelector('#contact-category-error');
        if (wrap) wrap.classList.remove('form-field--error');
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.hidden = true;
        }
        categoryInput.removeAttribute('aria-invalid');
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearFieldErrors(form);

      var values = getValues(form);
      var details = validateValues(values);

      var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
      var token = tokenInput ? tokenInput.value : '';
      if (!token) details.push('turnstile');

      if (details.length) {
        showFieldErrors(form, details, values);
        statusEl.textContent = details.length === 1
          ? 'Fix the highlighted field below.'
          : 'Fix the highlighted fields below.';
        statusEl.className = 'contact-status contact-status-error';
        return;
      }

      statusEl.textContent = '';
      statusEl.className = 'contact-status';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          category: values.category,
          message: values.message,
          turnstileToken: token
        })
      })
        .then(function (res) {
          return res.text().then(function (t) {
            var data = {};
            try { data = t ? JSON.parse(t) : {}; } catch (err) {}
            return { ok: res.ok, status: res.status, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data && result.data.ok) {
            submitBtn.textContent = 'Sent';
            statusEl.textContent = 'Your message has been sent.';
            statusEl.className = 'contact-status contact-status-success';
            clearFieldErrors(form);
            form.reset();
            if (typeof turnstile !== 'undefined' && turnstile.reset) turnstile.reset();
            return;
          }

          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';

          var err = (result.data && result.data.error) ? result.data.error : '';
          if (err === 'validation') {
            var serverDetails = (result.data && result.data.details) ? result.data.details : [];
            var fieldDetails = serverDetails.filter(function (d) {
              return d !== 'body';
            });
            if (fieldDetails.length) {
              showFieldErrors(form, fieldDetails, getValues(form));
              statusEl.textContent = fieldDetails.length === 1
                ? 'Fix the highlighted field below.'
                : 'Fix the highlighted fields below.';
            } else {
              statusEl.textContent = 'Please check the fields and try again.';
            }
            statusEl.className = 'contact-status contact-status-error';
            return;
          }

          var msg =
            err === 'turnstile_failed' ? 'Verification failed. Please try again.' :
            err === 'content_type' ? 'Submission failed. Please refresh and try again.' :
            'Something went wrong. Please try again.';

          statusEl.textContent = msg;
          statusEl.className = 'contact-status contact-status-error';
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
          statusEl.textContent = 'Something went wrong. Please try again.';
          statusEl.className = 'contact-status contact-status-error';
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContactForm);
  } else {
    initContactForm();
  }
})();
