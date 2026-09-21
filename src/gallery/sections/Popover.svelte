<script lang="ts">
  import Modal from "../../lib/ui/Modal.svelte";
  import Popover from "../../lib/ui/Popover.svelte";

  let modalOpen = $state(false);
</script>

<p class="row">
  Extinction-risk score
  <Popover label="About the ER-score rule">
    <p>The floor a statute asserts for a species' category (spec.md §5.5).</p>
    <button type="button" class="link" onclick={() => (modalOpen = true)}>More</button>
  </Popover>
</p>

<Modal open={modalOpen} title="The ER-score rule" onclose={() => (modalOpen = false)}>
  <p>
    <code>msens::compute_er_score()</code> applies a floor of 20 for MMPA (marine mammals) and 10 for
    MBTA (birds); a statute that does not cover a species' category never invents a floor for it (spec.md
    §5.5).
  </p>
</Modal>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    margin: 0;
  }

  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-link);
    text-decoration: underline;
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
