<script>
    import { createEventDispatcher } from 'svelte';
    
    /** @type {boolean} */
    export let visible = false;
    /** @type {number} */
    export let x = 0;
    /** @type {number} */
    export let y = 0;
    /** @type {any[]} */
    export let items = [];
    
    const dispatch = createEventDispatcher();
    
    /** @type {HTMLDivElement | null} */
    let menuElement;
    
    // Close menu when clicking outside
    /** @param {MouseEvent} event */
    function handleClickOutside(event) {
        const target = /** @type {Node} */ (event.target);
        if (visible && menuElement && !menuElement.contains(target)) {
            visible = false;
        }
    }
    
    // Close menu on escape key
    /** @param {KeyboardEvent} event */
    function handleKeyDown(event) {
        if (event.key === 'Escape') {
            visible = false;
        }
    }
    
    /** @param {any} item */
    function handleItemClick(item) {
        dispatch('item-click', item);
        visible = false;
    }
    
    // Adjust position if menu would go off screen
    function adjustPosition() {
        if (!menuElement) return;
        
        const rect = menuElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Adjust horizontal position
        if (x + rect.width > viewportWidth) {
            x = viewportWidth - rect.width - 10;
        }
        
        // Adjust vertical position
        if (y + rect.height > viewportHeight) {
            y = viewportHeight - rect.height - 10;
        }
        
        // Ensure minimum margins
        x = Math.max(10, x);
        y = Math.max(10, y);
    }
    
    $: if (visible && menuElement) {
        adjustPosition();
    }
</script>

<svelte:window 
    on:click={handleClickOutside} 
    on:keydown={handleKeyDown}
/>

{#if visible}
    <div
        role="menu"
        aria-label="Canvas context menu"
        bind:this={menuElement}
        class="canvas-context-menu"
        style="left: {x}px; top: {y}px;"
        tabindex="0"
        on:click|stopPropagation
        on:keydown={(e) => e.key === 'Escape' && (visible = false)}
    >
        {#each items as item}
            <div 
                class="menu-item"
                class:disabled={item.disabled}
                class:separator={item.separator}
                on:click={() => !item.disabled && !item.separator && handleItemClick(item)}
                on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && !item.disabled && !item.separator && handleItemClick(item)}
                role="menuitem"
                tabindex={item.disabled || item.separator ? -1 : 0}
            >
                {#if item.separator}
                    <div class="separator-line"></div>
                {:else}
                    <div class="item-content">
                        {#if item.icon}
                            <span class="item-icon">{item.icon}</span>
                        {/if}
                        <span class="item-label">{item.label}</span>
                        {#if item.shortcut}
                            <span class="item-shortcut">{item.shortcut}</span>
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}
    </div>
{/if}

<style>
    .canvas-context-menu {
        position: fixed;
        background: #1e1e2e; /* Catppuccin Mocha base */
        border: 1px solid #313244; /* Catppuccin Mocha surface0 */
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        padding: 6px;
        min-width: 200px;
        z-index: 999999; /* Very high z-index */
        font-size: 13px;
        user-select: none;
        color: #cdd6f4; /* Catppuccin Mocha text */
        backdrop-filter: blur(12px);
        animation: menuFadeIn 0.15s ease-out;
    }

    @keyframes menuFadeIn {
        from {
            opacity: 0;
            transform: scale(0.95) translateY(-5px);
        }
        to {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
    }

    .menu-item {
        padding: 0;
        margin: 0;
        cursor: pointer;
        border-radius: 6px;
        transition: background-color 0.1s ease;
    }

    .menu-item:hover:not(.disabled):not(.separator) {
        background-color: #313244; /* Catppuccin Mocha surface0 */
    }

    .menu-item.disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .menu-item.separator {
        cursor: default;
        padding: 3px 0;
    }

    .separator-line {
        height: 1px;
        background-color: #313244; /* Catppuccin Mocha surface0 */
        margin: 0 8px;
    }

    .item-content {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        gap: 10px;
        min-height: 36px; /* desktop: comfortable but compact */
    }

    .item-icon {
        font-size: 14px;
        width: 18px;
        text-align: center;
        flex-shrink: 0;
    }

    .item-label {
        flex: 1;
        white-space: nowrap;
        color: #cdd6f4; /* Catppuccin Mocha text */
        font-weight: 500;
    }

    .item-shortcut {
        font-size: 11px;
        color: #6c7086; /* Catppuccin Mocha overlay0 */
        opacity: 0.9;
        flex-shrink: 0;
        background: #313244;
        padding: 1px 5px;
        border-radius: 4px;
        font-family: monospace;
    }

    .menu-item:focus:not(.disabled):not(.separator) {
        background-color: #313244;
        outline: none;
    }

    /* ── Mobile / coarse pointer: bigger touch targets ─────────────────────── */
    @media (pointer: coarse), (max-width: 768px) {
        .canvas-context-menu {
            min-width: 220px;
            font-size: 15px;
            border-radius: 14px;
            padding: 8px;
        }

        .item-content {
            padding: 13px 16px;
            gap: 12px;
            min-height: 44px; /* Apple HIG minimum touch target */
        }

        .item-icon {
            font-size: 17px;
            width: 22px;
        }

        .menu-item.separator {
            padding: 4px 0;
        }

        .separator-line {
            margin: 0 10px;
        }

        .item-shortcut {
            /* Hide keyboard shortcuts on touch — they're irrelevant */
            display: none;
        }
    }
</style>