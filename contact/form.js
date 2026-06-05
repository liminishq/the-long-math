(function () {
  'use strict';

  var NAME_MIN = 2;
  var MESSAGE_MIN = 5;
  var MESSAGE_MAX = 4000;
  var ALLOWED_CATEGORIES = ['general', 'bug', 'correction', 'media', 'partnership'];
  var ALL_FIELDS = ['name', 'email', 'category', 'message', 'turnstile'];

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

  function getTurnstileToken(form) {
    var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
    return tokenInput ? (tokenInput.value || '').trim() : '';
  }

  function collectInvalidFields(form, checkTurnstile) {
    var values = getValues(form);
    var details = [];

    if (values.name.length < NAME_MIN) details.push('name');
    if (!values.email || values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      details.push('email');
    }
    if (ALLOWED_CATEGORIES.indexOf(values.category) === -1) details.push('category');
    if (values.message.length < MESSAGE_MIN || values.message.length > MESSAGE_MAX) details.push('message');
    if (checkTurnstile && !getTurnstileToken(form)) details.push('turnstile');

    return { values: values, details: details };
  }

  function messageForField(field, values) {
    switch (field) {
      case 'name':
        return 'Name must be at least ' + NAME_MIN + ' characters.';
      case 'email':
        if (!values.email) return 'Email is required.';
        return 'Enter a valid email address.';
      case 'category':
        return 'Please select a category.';
      case 'message':
        if (!values.message) return 'Message is required.';
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

  function clearFieldError(form, field) {
    var wrap = form.querySelector('[data-field="' + field + '"]');
    var errorEl = form.querySelector('#contact-' + field + '-error');
    var inputSel = FIELD_INPUT[field];
    var input = inputSel ? form.querySelector(inputSel) : null;

    if (wrap) wrap.classList.remove('form-field--error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
    if (input && input.removeAttribute) {
      input.removeAttribute('aria-invalid');
    }
  }

  function setFieldError(form, field, values) {
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
  }

  function clearAllFieldErrors(form) {
    ALL_FIELDS.forEach(function (field) {
      clearFieldError(form, field);
    });
  }

  function applyFieldErrors(form, details, values) {
    ALL_FIELDS.forEach(function (field) {
      if (details.indexOf(field) !== -1) {
        setFieldError(form, field, values);
      } else {
        clearFieldError(form, field);
      }
    });

    if (details.length) {
      var firstWrap = form.querySelector('.form-field--error');
      if (firstWrap && firstWrap.scrollIntoView) {
        firstWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function initContactForm() {
    var form = document.getElementById('contact-form');
    var submitBtn = document.getElementById('contact-submit');
    var statusEl = document.getElementById('contact-status');
    if (!form || !submitBtn || !statusEl) return;

    var validationActive = false;

    function refreshValidationUI(checkTurnstile) {
      var result = collectInvalidFields(form, checkTurnstile);
      applyFieldErrors(form, result.details, result.values);
      return result;
    }

    function showValidationStatus(count) {
      statusEl.textContent = count === 1
        ? 'Fix the highlighted field below.'
        : 'Fix the ' + count + ' highlighted fields below.';
      statusEl.className = 'contact-status contact-status-error';
    }

    ['name', 'email', 'message'].forEach(function (field) {
      var input = form.querySelector(FIELD_INPUT[field]);
      if (!input) return;
      input.addEventListener('input', function () {
        if (!validationActive) return;
        var result = refreshValidationUI(true);
        if (result.details.length) {
          showValidationStatus(result.details.length);
        } else {
          statusEl.textContent = '';
          statusEl.className = 'contact-status';
        }
      });
    });

    var categoryInput = form.querySelector(FIELD_INPUT.category);
    if (categoryInput) {
      categoryInput.addEventListener('change', function () {
        if (!validationActive) return;
        var result = refreshValidationUI(true);
        if (result.details.length) {
          showValidationStatus(result.details.length);
        } else {
          statusEl.textContent = '';
          statusEl.className = 'contact-status';
        }
      });
    }

    window.contactFormTurnstileReady = function () {
      if (!validationActive) return;
      var result = refreshValidationUI(true);
      if (result.details.length) {
        showValidationStatus(result.details.length);
      } else {
        statusEl.textContent = '';
        statusEl.className = 'contact-status';
      }
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      validationActive = true;

      var result = refreshValidationUI(true);
      if (result.details.length) {
        showValidationStatus(result.details.length);
        return;
      }

      validationActive = false;
      clearAllFieldErrors(form);
      statusEl.textContent = '';
      statusEl.className = 'contact-status';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: result.values.name,
          email: result.values.email,
          category: result.values.category,
          message: result.values.message,
          turnstileToken: getTurnstileToken(form)
        })
      })
        .then(function (res) {
          return res.text().then(function (t) {
            var data = {};
            try { data = t ? JSON.parse(t) : {}; } catch (err) {}
            return { ok: res.ok, status: res.status, data: data };
          });
        })
        .then(function (apiResult) {
          if (apiResult.ok && apiResult.data && apiResult.data.ok) {
            submitBtn.textContent = 'Sent';
            statusEl.textContent = 'Your message has been sent.';
            statusEl.className = 'contact-status contact-status-success';
            clearAllFieldErrors(form);
            form.reset();
            if (typeof turnstile !== 'undefined' && turnstile.reset) turnstile.reset();
            return;
          }

          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
          validationActive = true;

          var err = (apiResult.data && apiResult.data.error) ? apiResult.data.error : '';
          if (err === 'validation') {
            var serverDetails = (apiResult.data && apiResult.data.details) ? apiResult.data.details : [];
            var fieldDetails = serverDetails.filter(function (d) {
              return d !== 'body';
            });
            if (fieldDetails.length) {
              applyFieldErrors(form, fieldDetails, getValues(form));
              showValidationStatus(fieldDetails.length);
            } else {
              statusEl.textContent = 'Please check the fields and try again.';
              statusEl.className = 'contact-status contact-status-error';
            }
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
