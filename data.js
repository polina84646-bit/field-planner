document.addEventListener('DOMContentLoaded', () => {

    /* --- 1. Логика модального окна --- */
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    const modalClose = document.getElementById('modal-close');
    let lastModalTrigger = null;

    function openModal(title, text, trigger) {
        lastModalTrigger = trigger || document.activeElement;
        modalTitle.textContent = title;
        modalText.textContent = text;
        modal.hidden = false;
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        modalClose.focus();
    }

    function closeModal() {
        modal.classList.add('hidden');
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        if (lastModalTrigger) lastModalTrigger.focus();
    }

    function bindModalTriggers(elements, titleAttribute, textAttribute) {
        elements.forEach((element) => {
            const activate = () => {
                openModal(element.getAttribute(titleAttribute), element.getAttribute(textAttribute), element);
            };
            element.addEventListener('click', activate);
            element.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate();
                }
            });
        });
    }

    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    // Закрытие по Esc
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });

    /* --- 2. Клики по карточкам модулей --- */
    bindModalTriggers(document.querySelectorAll('.product-card.clickable'), 'data-module', 'data-desc');

    /* --- 3. Клики по факторам на схеме --- */
    bindModalTriggers(document.querySelectorAll('.clickable-factor'), 'data-title', 'data-text');

    /* --- 4. Логика интерактивного чек-листа (LocalStorage) --- */
    const checklistForm = document.getElementById('checklist-form');
    const newRuleInput = document.getElementById('new-rule');
    const checklistUl = document.getElementById('checklist-ul');

    // Загрузка сохраненных правил при старте
    let customRules = JSON.parse(localStorage.getItem('safetyRules')) || [];
    renderRules();

    checklistForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Предотвращаем перезагрузку страницы
        const ruleText = newRuleInput.value.trim();
        
        if (ruleText) {
            customRules.push(ruleText);
            saveRules();
            renderRules();
            newRuleInput.value = ''; // Очистить поле
        }
    });

    function saveRules() {
        localStorage.setItem('safetyRules', JSON.stringify(customRules));
    }

    function renderRules() {
        checklistUl.innerHTML = '';
        if (customRules.length === 0) {
            checklistUl.innerHTML = '<li style="border-left: none; background: transparent; color: #8c8279; justify-content: center;">Пока нет добавленных правил</li>';
            return;
        }

        customRules.forEach((rule, index) => {
            const li = document.createElement('li');
            li.textContent = rule;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Удалить';
            deleteBtn.className = 'delete-btn';
            deleteBtn.addEventListener('click', () => {
                // Удаляем элемент из массива по индексу
                customRules.splice(index, 1);
                saveRules();
                renderRules();
            });

            li.appendChild(deleteBtn);
            checklistUl.appendChild(li);
        });
    }

    /* --- 5. Обработка формы связи --- */
    const contactForm = document.getElementById('contact-form');
    const formStatus = document.getElementById('form-status');

    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        
        // Имитация отправки
        formStatus.textContent = 'Сообщение отправлено! (Демо-режим)';
        formStatus.style.color = '#2ecc71';
        
        // Очистка формы
        contactForm.reset();

        // Скрываем сообщение через 3 секунды
        setTimeout(() => {
            formStatus.textContent = '';
        }, 3000);
    });
});