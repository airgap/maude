<script lang="ts">
  let { children } = $props<{ children: any }>();
</script>

<div class="message-animation-wrapper">
  {@render children()}
</div>

<style>
  .message-animation-wrapper {
    animation: fadeIn 0.3s ease-out forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
